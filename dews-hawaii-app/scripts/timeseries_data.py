import os
import re
import glob
import requests
import pandas as pd
import numpy as np
import geopandas as gpd
import rasterio
from rasterio.features import rasterize
from dateutil.relativedelta import relativedelta
from urllib.parse import urlencode
from datetime import datetime

DATASETS = {
    "drought": {
        "url": "https://api.hcdp.ikewai.org/raster",
        "params": {
            "datatype": "spi",
            "period": "month",
            "timescale": None  # placeholder
        },
        "scales": [1, 6, 12]
    },
    "rainfall": {
        "url": "https://api.hcdp.ikewai.org/raster",
        "params": {
            "datatype": "rainfall",
            "production": "new",
            "period": "month"
        },
        "scales": [None]
    },
    "temperature": {
        "url": "https://api.hcdp.ikewai.org/raster",
        "params": {
            "datatype": "temperature",
            "aggregation": "mean",
            "period": "month"
        },
        "scales": [None]
    }
}

START_DATE = datetime(2020, 9, 1)
END_DATE = datetime(2025, 8, 1)
RASTER_DIR = "./data"

def get_key_from_environment(file_path, key):
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
    pattern = rf'{key}\s*:\s*[\'"]([^\'"]+)[\'"]'
    match = re.search(pattern, content)
    return match.group(1) if match else None

API_KEY = get_key_from_environment("../src/environments/environment.ts", "apiToken")

def fetch_tifs(dataset, scale=None):
    """Download all rasters for given dataset and scale."""
    info = DATASETS[dataset]
    headers = {"Authorization": f"Bearer {API_KEY}"}

    params = info["params"].copy()
    if scale:
        params["timescale"] = f"timescale{scale:03d}"

    date = START_DATE
    while date <= END_DATE:
        params["date"] = date.strftime("%Y-%m")
        query = urlencode(params)
        url = f"{info['url']}?{query}"

        out_path = f"{RASTER_DIR}/" \
           f"{dataset if dataset != 'drought' else ''}" \
           f"{f'spi{scale:03d}' if scale else ''}" \
           f"_{params['date']}.tif"

        res = requests.get(url, headers=headers)
        if res.status_code == 200:
            with open(out_path, "wb") as f:
                f.write(res.content)
            print(f"Saved {out_path}")
        else:
            print(f"{res.status_code} for {url}")

        date += relativedelta(months=1)

def get_averages(division, id_col, dataset="rainfall", scale=None):
    shp_path = f"../public/shapefiles/{division}.shp"
    gdf = gpd.read_file(shp_path).reset_index(drop=True)

    # Detect island field if present
    possible_island_cols = ["island", "ISLAND", "mokupuni", "Mokupuni"]
    island_col = next((c for c in possible_island_cols if c in gdf.columns), None)

    # --- Handle duplicates depending on division type ---
    if division == "county":
        # unify all Maui County islands together
        county_map = {
            "Hawaiʻi": "Hawaiʻi",
            "Maui": "Maui",
            "Molokaʻi": "Maui",
            "Lānaʻi": "Maui",
            "Kahoʻolawe": "Maui",
            "Oʻahu": "Honolulu",
            "Kauaʻi": "Kauaʻi",
            "Niʻihau": "Kauaʻi"
        }
        # Create a unified county column
        if island_col:
            gdf["county_name"] = gdf[island_col].map(county_map)
        else:
            gdf["county_name"] = gdf[id_col]

        # Dissolve all features by the unified county name
        gdf = gdf.dissolve(by="county_name", as_index=False)
        gdf[id_col] = gdf["county_name"]
        gdf["division_full"] = gdf[id_col]

    else:
        # detect island column if available
        possible_island_cols = ["island", "ISLAND", "mokupuni", "Mokupuni", "isle"]
        island_col = next((c for c in possible_island_cols if c in gdf.columns), None)

        if island_col:
            # dissolve by both island + name — merges duplicates within same island only
            gdf = gdf.dissolve(by=[island_col, id_col], as_index=False)
            gdf["division_full"] = gdf.apply(
                lambda r: f"{r[island_col]}::{r[id_col]}", axis=1
            )
        else:
            # fallback if no island field exists
            gdf = gdf.dissolve(by=id_col, as_index=False)
            gdf["division_full"] = gdf[id_col]


    # --- Collect rasters ---
    if dataset == "drought":
        tif_pattern = f"spi{int(scale):03d}_*.tif" if scale is not None else "spi*.tif"
    else:
        tif_pattern = f"{dataset}_*.tif"
    tifs = sorted(glob.glob(os.path.join(RASTER_DIR, tif_pattern)))
    if not tifs:
        raise FileNotFoundError(f"No rasters found for {tif_pattern}")

    # --- Metadata ---
    with rasterio.open(tifs[0]) as src:
        raster_crs = src.crs
        transform = src.transform
        shape = (src.height, src.width)

    if gdf.crs != raster_crs:
        gdf = gdf.to_crs(raster_crs)

    # Rasterize once
    shapes = [(geom, idx) for idx, geom in enumerate(gdf.geometry)]
    mask = rasterize(shapes, out_shape=shape, transform=transform, fill=-1, dtype="int32")

    records = []
    for tif in tifs:
        date = os.path.basename(tif).split("_")[1].replace(".tif", "")
        with rasterio.open(tif) as src:
            arr = src.read(1, masked=True)

        for idx, div in enumerate(gdf["division_full"]):
            poly_mask = mask == idx
            vals = arr[poly_mask]
            if np.ma.is_masked(vals):
                vals = vals.compressed()
            mean_val = np.nan if vals.size == 0 else np.nanmean(vals)
            records.append({"division": div, "date": date, "mean_val": mean_val})

    df = (
        pd.DataFrame(records)
        .groupby(["division", "date"])["mean_val"]
        .mean()
        .reset_index()
        .pivot(index="division", columns="date", values="mean_val")
    )
    df = df.reindex(sorted(df.columns), axis=1)

    if dataset == "drought":
        # Always include spi scale (e.g. spi1, spi6, spi12)
        scale_str = f"spi{int(scale)}" if scale is not None else "spi"
        out_csv = f"../public/{division}_{scale_str}.csv"
    else:
        out_csv = f"../public/{division}_{dataset}.csv"

    df.to_csv(out_csv)
    print(f"Saved {out_csv} ({len(df)} rows)")


# datasets = ["drought", "rainfall", "temperature"]
scales = [1, 6, 12]

for dataset, cfg in DATASETS.items():
    for scale in cfg["scales"]:
        fetch_tifs(dataset, scale)
        for div, col in [("county", "county"), ("moku", "moku"), ("ahupuaa", "ahupuaa"), ("climate", "name"), ("watershed", "name")]:
            get_averages(div, col, dataset, scale)

        # clear downloaded rasters
        for f in glob.glob(f"{RASTER_DIR}/*.tif"):
            os.remove(f)
