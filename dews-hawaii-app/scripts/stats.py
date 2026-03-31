import os
import re
import glob
import argparse
import requests
import pandas as pd
import numpy as np
import geopandas as gpd
import rasterio
from urllib.parse import urlencode
from datetime import datetime
from rasterstats import zonal_stats

DATASETS = {
    "rainfall_new": {
        "url": "https://api.hcdp.ikewai.org/raster",
        "climo_url": "./data/climo/rainfall/monthly_rainfall_clim_statewide_1991-2020_8.tif",
        "params": {"datatype": "rainfall", "production": "new", "period": "month"},
    },
    "rainfall_legacy": {
        "url": "https://api.hcdp.ikewai.org/raster",
        "climo_url": "./data/climo/rainfall/monthly_rainfall_clim_statewide_1991-2020_8.tif",
        "params": {"datatype": "rainfall", "production": "legacy", "period": "month"},
    },
    "temperature": {
        "url": "https://api.hcdp.ikewai.org/raster",
        "climo_url": "./data/climo/temperature/monthly_air_temp_clim_statewide_1991-2020_8.tif",
        "params": {"datatype": "temperature", "aggregation": "mean", "period": "month"},
    },
}

DATE = datetime(2025, 8, 1)
MONTH = DATE.month
RASTER_DIR = "./data"

def get_key_from_environment(file_path, key):
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
    pattern = rf'{key}\s*:\s*[\'"]([^\'"]+)[\'"]'
    match = re.search(pattern, content)
    return match.group(1) if match else None


API_KEY = get_key_from_environment("../src/environments/environment.ts", "apiToken")

def fetch_tifs(dataset, start_year=1991, end_year=datetime.now().year, month=8):
    """Download August GeoTIFFs for a dataset from start_year–end_year."""
    info = DATASETS[dataset]
    headers = {"Authorization": f"Bearer {API_KEY}"}
    os.makedirs(RASTER_DIR, exist_ok=True)

    for year in range(start_year, end_year + 1):
        params = info["params"].copy()
        params["date"] = f"{year}-{month:02d}-01"
        query = urlencode(params)
        url = f"{info['url']}?{query}"

        if dataset in ["rainfall_new", "rainfall_legacy"]:
            dataset_name = "rainfall"
        else:
            dataset_name = dataset

        out_path = os.path.join(RASTER_DIR, f"{dataset_name}_{year}_{month:02d}.tif")

        if os.path.exists(out_path):
            print(f"Skipping {out_path} (already exists)")
            continue

        print(f"Fetching {dataset} for {params['date']}...")
        res = requests.get(url, headers=headers)
        if res.status_code == 200:
            with open(out_path, "wb") as f:
                f.write(res.content)
            print(f"Saved {out_path}")
        else:
            print(f"{res.status_code} for {url}")

def convert_units(value, dataset):
    """Convert rainfall mm→inches and temperature °C→°F."""
    if value is None or np.isnan(value):
        return np.nan
    if dataset == "rainfall":
        return value / 25.4  # mm → inches
    elif dataset == "temperature":
        return (value * 9/5) + 32  # °C → °F
    return value


def get_stats(division, dataset="rainfall"):
    """Compute rainfall or temperature statistics for a division shapefile."""
    shapefile = f"../public/shapefiles/{division}.shp"
    raster_folder = f"{RASTER_DIR}/"
    lookup_key = "rainfall_new" if dataset == "rainfall" else dataset
    climo_file = DATASETS[lookup_key]["climo_url"]
    tif_path = "/Users/cherryleheu/Documents/HCDP/Data/monthly/SPI_historical/SPI_historical_new/spi1_2025_08.tif"

    print(f"\n--- Processing {division} ({dataset}) ---")

    # --- Load shapefile ---
    gdf = gpd.read_file(shapefile).copy()

    island_col = next((c for c in gdf.columns if c.lower() in ["island", "mokupuni", "isle", "islandname"]), None)
    name_col = next((c for c in gdf.columns if c.lower() in ["name", "division", "moku", "climate_div", "ahupuaa", "county"]), None)

    if island_col and name_col:
        # Dissolve by both to keep data clean, then create the Maui::Name string
        gdf = gdf.dissolve(by=[island_col, name_col], as_index=False)
        gdf["division_full"] = gdf.apply(lambda r: f"{r[island_col]}::{r[name_col]}", axis=1)
    elif name_col:
        gdf = gdf.dissolve(by=name_col, as_index=False)
        gdf["division_full"] = gdf[name_col].astype(str)
    else:
        raise ValueError(f"No valid name column found in {division}.shp")

    # --- 2. Climatology Stats ---
    climo_zs = zonal_stats(vectors=gdf, raster=climo_file, stats=["mean"], nodata=None)
    gdf["climo_mean"] = [convert_units(c["mean"], dataset) for c in climo_zs]

    # --- 3. Historical Time Series Loop ---
    all_records = []
    for tif in sorted(glob.glob(os.path.join(raster_folder, f"{dataset}_*_08.tif"))):
        parts = os.path.basename(tif).replace(".tif", "").split("_")
        year, month = parts[1], parts[2]
        date = f"{year}-{month}"
        if year == "1990":
            continue

        stats = zonal_stats(vectors=gdf, raster=tif, stats=["mean"], nodata=None)

        for idx, row in gdf.iterrows():
            mean_raw = stats[idx]["mean"]
            if mean_raw is None or np.isnan(mean_raw):
                mean_val, anomaly, pchange = np.nan, np.nan, np.nan
            else:
                mean_val = convert_units(mean_raw, dataset)
                climo_mean = row["climo_mean"]
                if np.isnan(climo_mean):
                    anomaly, pchange = np.nan, np.nan
                else:
                    anomaly = mean_val - climo_mean
                    pchange = ((mean_val - climo_mean) / climo_mean) * 100 if dataset == "rainfall" else anomaly

            all_records.append({
                "division_full": row["division_full"],
                "date": date,
                "mean": mean_val,
                "anomaly": anomaly,
                "pchange": pchange,
            })

    # if os.path.exists(tif_path):
    #     def pct_less_than_half(values):
    #         vals = np.array(values, dtype=float)
    #         vals = vals[np.isfinite(vals)]
    #         return (np.sum(vals < -0.5) / len(vals)) * 100 if len(vals) > 0 else np.nan

    #     with rasterio.open(tif_path) as src:
    #         mask = src.read_masks(1)
    #         nodata = src.nodata

    #     percent_stats = zonal_stats(
    #         vectors=gdf,
    #         raster=tif_path,
    #         stats=None,
    #         add_stats={"pct_drought": pct_less_than_half},
    #         nodata=nodata
    #     )
    #     gdf["pct_drought"] = [s["pct_drought"] for s in percent_stats]
    # else:
    #     gdf["pct_drought"] = np.nan

    # --- Merge + Export ---
    df = pd.DataFrame(all_records)
    if "division_full" not in df.columns:
        raise ValueError("division_full column missing from records dataframe")

    df["rank"] = df.groupby("division_full")["anomaly"].rank(method="min")
    # merged = df.merge(gdf[["division_full", "pct_drought"]], on="division_full", how="left")
    latest_df = df[df["date"] == "2025-08"].reset_index(drop=True)

    out_csv = f"../public/{dataset}/{division}_{dataset}_stats.csv"
    latest_df.to_csv(out_csv, index=False)
    print(f"Saved {out_csv}")

def get_statewide_stats(dataset="rainfall"):
    """Compute statewide mean, anomaly, percent change, and drought percentage."""
    raster_folder = f"{RASTER_DIR}/"
    lookup_key = "rainfall_new" if dataset == "rainfall" else dataset
    climo_file = DATASETS[lookup_key]["climo_url"]
    tif_path = "/Users/cherryleheu/Documents/HCDP/Data/monthly/SPI_historical/SPI_historical_new/spi1_2025_08.tif"

    print(f"\n--- Processing statewide ({dataset}) ---")

    # --- Load climatology ---
    with rasterio.open(climo_file) as src:
        clim = src.read(1).astype(float)
        clim = np.where(src.nodata == src.read(1), np.nan, clim)
        climo_mean = convert_units(np.nanmean(clim), dataset)

    # --- Loop through all historical rasters to get mean and anomaly ---
    all_records = []
    for tif in sorted(glob.glob(os.path.join(raster_folder, f"{dataset}_*_08.tif"))):
        parts = os.path.basename(tif).replace(".tif", "").split("_")
        year, month = parts[1], parts[2]
        date = f"{year}-{month}"

        with rasterio.open(tif) as src:
            arr = src.read(1).astype(float)
            arr = np.where(arr == src.nodata, np.nan, arr)
            mean_val = convert_units(np.nanmean(arr), dataset)

        anomaly = mean_val - climo_mean
        pchange = ((mean_val - climo_mean) / climo_mean) * 100 if dataset == "rainfall" else anomaly

        all_records.append({
            "date": date,
            "year": int(year),
            "mean": mean_val,
            "anomaly": anomaly,
            "pchange": pchange,
        })

    df = pd.DataFrame(all_records)

    # --- Rank logic (dry for rainfall, warm for temperature) ---
    ascending = True if dataset == "rainfall" else False
    df["rank"] = df["anomaly"].rank(method="min", ascending=ascending)

    # --- Extract 2025-08 record ---
    latest = df[df["date"] == "2025-08"].copy()
    if latest.empty:
        print("No data found for 2025-08")
        return

    # --- Compute drought percentage ---
    if os.path.exists(tif_path):
        with rasterio.open(tif_path) as src:
            spi = src.read(1).astype(float)
            spi = np.where(spi == src.nodata, np.nan, spi)
            dry_pct = (np.sum(spi < -0.5) / np.isfinite(spi).sum()) * 100
    else:
        dry_pct = np.nan

    latest["division_full"] = "Statewide"
    latest["dry_pct"] = dry_pct

    out_csv = f"../public/{dataset}/statewide_{dataset}_stats.csv"
    latest.to_csv(out_csv, index=False)
    print(f"Saved {out_csv}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compute rainfall and temperature stats for all divisions")
    parser.add_argument("--fetch", action="store_true", help="Download GeoTIFFs before computing stats")
    args = parser.parse_args()

    divisions = ["island", "moku", "ahupuaa", "watershed"]
    datasets = ["rainfall", "temperature"]

    if args.fetch:
        for dataset in datasets:
            if dataset == "rainfall":
                fetch_tifs("rainfall_legacy", start_year=1920, end_year=1989, month=8)
                fetch_tifs("rainfall_new", start_year=1991, end_year=2025, month=8)
            else:
              fetch_tifs(dataset, start_year=1990, end_year=2025, month=8)
    for dataset in datasets:
        try:
            get_statewide_stats(dataset)
        except Exception as e:
            print(f"Error processing statewide ({dataset}): {e}")
    for division in divisions:
        for dataset in datasets:
            try:
                get_stats(division, dataset)
            except Exception as e:
                print(f"Error processing {division} ({dataset}): {e}")


    print("Cleaning up downloaded TIFFs...")
    for f in glob.glob(f"{RASTER_DIR}/*.tif"):
        try:
            os.remove(f)
        except Exception as e:
            print(f"Could not remove {f}: {e}")

# python your_script_name.py --fetch
