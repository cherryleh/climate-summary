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
    "rainfall": {
        "url": "https://api.hcdp.ikewai.org/raster",
        "climo_url": "./data/climo/rainfall/monthly_rainfall_clim_statewide_1991-2020_8.tif",
        "params": {"datatype": "rainfall", "production": "new", "period": "month"},
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

# ---------------------------------------------------------------------
# Load API key
# ---------------------------------------------------------------------
def get_key_from_environment(file_path, key):
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
    pattern = rf'{key}\s*:\s*[\'"]([^\'"]+)[\'"]'
    match = re.search(pattern, content)
    return match.group(1) if match else None


API_KEY = get_key_from_environment("../src/environments/environment.ts", "apiToken")

# ---------------------------------------------------------------------
# Download GeoTIFFs from API
# ---------------------------------------------------------------------
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
        out_path = os.path.join(RASTER_DIR, f"{dataset}_{year}_{month:02d}.tif")

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

def get_stats(division, dataset="rainfall"):
    """Compute rainfall or temperature statistics for a division shapefile."""
    shapefile = f"../public/shapefiles/{division}.shp"
    raster_folder = f"{RASTER_DIR}/"
    climo_file = DATASETS[dataset]["climo_url"]
    tif_path = "/Users/cherryleheu/Documents/HCDP/Data/monthly/SPI_historical/SPI_historical_new/spi1_2025_08.tif"

    print(f"\n--- Processing {division} ({dataset}) ---")

    # --- Load shapefile ---
    gdf = gpd.read_file(shapefile).copy()

    island_col = next(
        (c for c in gdf.columns if c.lower() in ["island", "mokupuni", "isle", "islandname"]),
        None
    )
    name_col = next(
        (c for c in gdf.columns if c.lower() in ["name", "division", "moku", "climate_div", "ahupuaa", "county"]),
        None
    )

    if island_col and name_col:
        print(f"Using island_col='{island_col}', name_col='{name_col}'")
        gdf["division_full"] = gdf[island_col].astype(str) + "::" + gdf[name_col].astype(str)
        gdf = gdf.dissolve(by="division_full", as_index=False)
    elif name_col:
        print(f"No island column found — using only '{name_col}'")
        gdf["division_full"] = gdf[name_col].astype(str)
        gdf = gdf.dissolve(by="division_full", as_index=False)
    else:
        raise ValueError("No valid island or name column found in shapefile.")

    if "division_full" not in gdf.columns:
        gdf = gdf.reset_index()
        if "division_full" not in gdf.columns and "index" in gdf.columns:
            gdf.rename(columns={"index": "division_full"}, inplace=True)

    climo_stats = zonal_stats(vectors=gdf, raster=climo_file, stats=["mean"], nodata=None)
    gdf["climo_mean"] = [
        (c["mean"] / 25.4) if (dataset == "rainfall" and c["mean"] is not None) else
        (c["mean"] if c["mean"] is not None else np.nan)
        for c in climo_stats
    ]

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
                mean_val = mean_raw / 25.4 if dataset == "rainfall" else mean_raw
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

    if os.path.exists(tif_path):
        def pct_less_than_half(values):
            vals = np.array(values, dtype=float)
            vals = vals[np.isfinite(vals)]
            return (np.sum(vals < -0.5) / len(vals)) * 100 if len(vals) > 0 else np.nan

        with rasterio.open(tif_path) as src:
            mask = src.read_masks(1)
            nodata = src.nodata

        percent_stats = zonal_stats(
            vectors=gdf,
            raster=tif_path,
            stats=None,
            add_stats={"pct_drought": pct_less_than_half},
            nodata=nodata
        )
        gdf["pct_drought"] = [s["pct_drought"] for s in percent_stats]
    else:
        gdf["pct_drought"] = np.nan

    # --- Merge + Export ---
    df = pd.DataFrame(all_records)
    if "division_full" not in df.columns:
        raise ValueError("division_full column missing from records dataframe")

    df["rank"] = df.groupby("division_full")["anomaly"].rank(method="min")
    merged = df.merge(gdf[["division_full", "pct_drought"]], on="division_full", how="left")
    latest_df = merged[merged["date"] == "2025-08"].reset_index(drop=True)

    out_csv = f"../public/{division}_{dataset}_stats.csv"
    latest_df.to_csv(out_csv, index=False)
    print(f"Saved {out_csv}")


# ---------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compute rainfall and temperature stats for all divisions")
    parser.add_argument("--fetch", action="store_true", help="Download GeoTIFFs before computing stats")
    args = parser.parse_args()

    divisions = ["county", "moku", "ahupuaa", "watershed"]
    datasets = ["rainfall", "temperature"]

    if args.fetch:
        for dataset in datasets:
            fetch_tifs(dataset, start_year=1991, end_year=2025, month=8)

    for division in divisions:
        for dataset in datasets:
            try:
                get_stats(division, dataset)
            except Exception as e:
                print(f"Error processing {division} ({dataset}): {e}")

    # --- Clean up ---
    print("Cleaning up downloaded TIFFs...")
    for f in glob.glob(f"{RASTER_DIR}/*.tif"):
        try:
            os.remove(f)
        except Exception as e:
            print(f"Could not remove {f}: {e}")