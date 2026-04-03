from dateutil import parser
import os
import re
import glob
import argparse
from matplotlib.dates import relativedelta
import requests
import pandas as pd
import numpy as np
import geopandas as gpd
import rasterio
from urllib.parse import urlencode
from datetime import datetime
from rasterstats import zonal_stats
import pytz
import sys

API_KEY = os.environ.get('HCDP_API_TOKEN')
local_dep_dir = os.environ.get('DEPENDENCY_DIR')

# DATASETS = {
#     "rainfall_new": {
#         "url": "https://api.hcdp.ikewai.org/raster",
#         "climo_url": "./data/climo/rainfall/monthly_rainfall_clim_statewide_1991-2020_8.tif",
#         "params": {"datatype": "rainfall", "production": "new", "period": "month"},
#     },
#     "rainfall_legacy": {
#         "url": "https://api.hcdp.ikewai.org/raster",
#         "climo_url": "./data/climo/rainfall/monthly_rainfall_clim_statewide_1991-2020_8.tif",
#         "params": {"datatype": "rainfall", "production": "legacy", "period": "month"},
#     },
#     "temperature": {
#         "url": "https://api.hcdp.ikewai.org/raster",
#         "climo_url": "./data/climo/temperature/monthly_air_temp_clim_statewide_1991-2020_8.tif",
#         "params": {"datatype": "temperature", "aggregation": "mean", "period": "month"},
#     },
# }



def convert_units(value, dataset):
    """Convert rainfall mm to inches and temperature C to F"""
    if value is None or np.isnan(value):
        return np.nan
    if dataset == "rainfall":
        return value / 25.4
    elif dataset == "temperature":
        return (value * 9/5) + 32
    return value


def get_stats(division, dataset, year, month):
    """Compute rainfall or temperature statistics for a island or division shapefile."""
    shapefile = os.path.join(local_dep_dir, f"shapefiles/{division}.shp")
    climo_file = os.path.join(local_dep_dir, f"climo/{dataset}/{dataset}_1991-2020_{month:02d}.tif")
    # tif_path = "/Users/cherryleheu/Documents/HCDP/Data/monthly/SPI_historical/SPI_historical_new/spi1_2025_08.tif"

    print(f"\n--- Processing {division} ({dataset}) ---")

    gdf = gpd.read_file(shapefile).copy()

    island_col = next((c for c in gdf.columns if c.lower() in ["island", "mokupuni", "isle", "islandname"]), None)
    name_col = next((c for c in gdf.columns if c.lower() in ["name", "division", "moku", "climate_div", "ahupuaa", "county", "name_hwn"]), None)

    if island_col and name_col:
        # 1. Flag rows that share BOTH the same island and the same name
        is_same_island_dup = gdf.duplicated(subset=[island_col, name_col], keep=False)

        # 2. Create a sequential counter (1, 2, 3...) for these specific groups
        cum_count = gdf.groupby([island_col, name_col]).cumcount() + 1

        # 3. Append the counter to the name column ONLY for the flagged duplicates
        gdf.loc[is_same_island_dup, name_col] = (
            gdf.loc[is_same_island_dup, name_col].astype(str) + " " + cum_count[is_same_island_dup].astype(str)
        )

        # 4. Now perform the dissolve (same-island duplicates are now uniquely named so they won't merge)
        gdf = gdf.dissolve(by=[island_col, name_col], as_index=False)
        gdf["division_full"] = gdf.apply(lambda r: f"{r[island_col]}::{r[name_col]}", axis=1)

    elif name_col:
        gdf = gdf.dissolve(by=name_col, as_index=False)
        gdf["division_full"] = gdf[name_col].astype(str)
    else:
        raise ValueError(f"No valid name column found in {division}.shp")

    # Climatology
    climo_zs = zonal_stats(vectors=gdf, raster=climo_file, stats=["mean"], nodata=None)
    gdf["climo_mean"] = [convert_units(c["mean"], dataset) for c in climo_zs]

    # Loop through all historical rasters to get ranks
    all_records = []
    for tif in sorted(glob.glob(os.path.join(local_dep_dir, f"{dataset}_*_{month:02d}.tif"))):
        parts = os.path.basename(tif).replace(".tif", "").split("_")
        curr_year, curr_month = parts[1], parts[2]
        curr_date = f"{curr_year}-{curr_month}"
        # if year == "1990":
        #     continue

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
                "date": curr_date,
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
    latest_df = df[df["date"] == f"{year}-{month:02d}"].reset_index(drop=True)
    out_csv = f"../public/{dataset}/{division}_{dataset}_stats.csv"
    latest_df.to_csv(out_csv, index=False)
    print(f"Saved {out_csv}")

def get_statewide_stats(dataset, year, month):
    """Compute statewide mean, anomaly, percent change, and drought percentage."""
    climo_file = climo_file = os.path.join(local_dep_dir, f"climo/{dataset}/{dataset}_1991-2020_{month:02d}.tif")
    # tif_path = f"/Users/cherryleheu/Documents/HCDP/Data/monthly/SPI_historical/SPI_historical_new/spi1_2025_{month:02d}.tif"

    print(f"\n--- Processing statewide ({dataset}) ---")

    # Load climo
    with rasterio.open(climo_file) as src:
        clim = src.read(1).astype(float)
        clim = np.where(src.nodata == src.read(1), np.nan, clim)
        climo_mean = convert_units(np.nanmean(clim), dataset)

    # Loop through historical
    all_records = []
    for tif in sorted(glob.glob(os.path.join(local_dep_dir, f"{dataset}_*_{month:02d}.tif"))):
        parts = os.path.basename(tif).replace(".tif", "").split("_")
        curr_year, curr_month = parts[1], parts[2]
        curr_date = f"{curr_year}-{curr_month}"

        with rasterio.open(tif) as src:
            arr = src.read(1).astype(float)
            arr = np.where(arr == src.nodata, np.nan, arr)
            mean_val = convert_units(np.nanmean(arr), dataset)

        anomaly = mean_val - climo_mean
        pchange = ((mean_val - climo_mean) / climo_mean) * 100 if dataset == "rainfall" else anomaly

        all_records.append({
            "date": curr_date,
            "mean": mean_val,
            "anomaly": anomaly,
            "pchange": pchange,
        })

    df = pd.DataFrame(all_records)

    ascending = True if dataset == "rainfall" else False
    df["rank"] = df["anomaly"].rank(method="min", ascending=ascending)

    latest = df[df["date"] == f"{year_value}-{month:02d}"].copy()
    if latest.empty:
        print(f"No data found for {year_value}-{month:02d}")
        return

    # if os.path.exists(tif_path):
    #     with rasterio.open(tif_path) as src:
    #         spi = src.read(1).astype(float)
    #         spi = np.where(spi == src.nodata, np.nan, spi)
    #         dry_pct = (np.sum(spi < -0.5) / np.isfinite(spi).sum()) * 100
    # else:
    #     dry_pct = np.nan

    latest["division_full"] = "Statewide"
    # latest["dry_pct"] = dry_pct

    out_csv = f"../public/{dataset}/statewide_{dataset}_stats.csv"
    latest.to_csv(out_csv, index=False)
    print(f"Saved {out_csv}")


if __name__ == "__main__":
    divisions = ["island", "climate", "moku", "ahupuaa", "watershed"]
    datasets = ["rainfall", "temperature"]

    hst = pytz.timezone('HST')
    date = None

    if len(sys.argv) > 1:
      input_date = sys.argv[1]
      date = parser.parse(input_date).astimezone(hst)
    else:
      today = datetime.now(hst)
      today = today.replace(hour = 0, minute = 0, second = 0, microsecond = 0)
      date = today - relativedelta(days = 1)

    month_value = date.month
    year_value = date.year

    for dataset in datasets:
        try:
            get_statewide_stats(dataset, year_value, month_value)
        except Exception as e:
            print(f"Error processing statewide ({dataset}): {e}")
    for division in divisions:
        for dataset in datasets:
            try:
                get_stats(division, dataset, year_value, month_value)
            except Exception as e:
                print(f"Error processing {division} ({dataset}): {e}")


