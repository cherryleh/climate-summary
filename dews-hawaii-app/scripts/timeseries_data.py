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

def get_averages(scale, division, id_col):
    shp_path = f"../public/shapefiles/{division}.shp"

    # Load shapefile
    gdf = gpd.read_file(shp_path)
    gdf = gdf.reset_index(drop=True)

    # --- Handle duplicates depending on division type ---
    if division in ["county", "climate"]:
        gdf = gdf.dissolve(by=id_col, as_index=False)
    else:
        # Make IDs unique by adding -1, -2, etc. for duplicates
        counts = {}
        unique_names = []
        for name in gdf[id_col]:
            if name in counts:
                counts[name] += 1
                unique_names.append(f"{name}-{counts[name]}")
            else:
                counts[name] = 0
                unique_names.append(name)
        gdf[id_col] = unique_names

    # Collect rasters
    tifs = sorted(glob.glob(os.path.join(RASTER_DIR, f"*.tif")))
    if not tifs:
        raise FileNotFoundError("No rasters found")

    # Get raster metadata
    with rasterio.open(tifs[0]) as src:
        raster_crs = src.crs
        transform = src.transform
        shape = (src.height, src.width)

    if gdf.crs != raster_crs:
        gdf = gdf.to_crs(raster_crs)

    # Rasterize polygons once
    shapes = [(geom, idx) for idx, geom in enumerate(gdf.geometry)]
    mask = rasterize(shapes, out_shape=shape, transform=transform, fill=-1, dtype="int32")

    records = []

    for tif in tifs:
        date = os.path.basename(tif).split("_")[1].replace(".tif", "")
        with rasterio.open(tif) as src:
            arr = src.read(1, masked=True)

        for idx, div in enumerate(gdf[id_col]):
            poly_mask = mask == idx
            vals = arr[poly_mask]

            # Drop masked values cleanly
            if np.ma.is_masked(vals):
                vals = vals.compressed()
            mean_val = np.nan if vals.size == 0 else np.nanmean(vals)
            records.append({"division": div, "date": date, "mean_spi": mean_val})

    df = pd.DataFrame(records)

    df = (
        df.groupby(["division", "date"])["mean_spi"]
        .mean()
        .reset_index()
    )

    df = df.pivot(index="division", columns="date", values="mean_spi")
    df = df.reindex(sorted(df.columns), axis=1)

    out_csv = f"../public/{division}_" \
      f"{dataset if dataset != 'drought' else ''}" \
      f"{f'spi{scale}' if scale else ''}.csv"
    df.to_csv(out_csv)
    print(f"Saved {out_csv}")


datasets = ["drought", "rainfall", "temperature"]
scales = [1, 6, 12]

for dataset, cfg in DATASETS.items():
    for scale in cfg["scales"]:
        fetch_tifs(dataset, scale)
        for div, col in [("county", "county"), ("moku", "moku"), ("ahupuaa", "ahupuaa"), ("climate", "name"), ("watershed", "name")]:
            get_averages(scale, div, col)
        # clear downloaded rasters
        for f in glob.glob(f"{RASTER_DIR}/*.tif"):
            os.remove(f)
