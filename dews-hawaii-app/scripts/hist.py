import pandas as pd
import pytz
import geopandas as gpd
import os
import rasterio
import numpy as np
from rasterstats import zonal_stats
from datetime import datetime
from dateutil.relativedelta import relativedelta
from dateutil import parser
import sys

local_dep_dir = os.environ.get('DEPENDENCY_DIR')

DIVISION_ID_COLS = {
    "island": "name",
    "climate": "name",
    "moku": "moku",
    "ahupuaa": "ahupuaa",
    "watershed": "name_hwn"
}

def get_averages_for_dataset(division, id_col, dataset, target_dates, raster_folder):
    """
    Compute mean values per polygon for a specific dataset over 5 years.
    Format: island, division_type, name, date, value
    """
    print(f"Processing {division} for {dataset}...")

    shp_path = os.path.join(local_dep_dir, f"shapefiles/{division}.shp")
    if not os.path.exists(shp_path):
        print(f"Shapefile not found: {shp_path}")
        return

    gdf = gpd.read_file(shp_path).reset_index(drop=True)

    # Identify columns for schema
    possible_island_cols = ["island", "ISLAND", "mokupuni", "Mokupuni", "isle"]
    island_col = next((c for c in possible_island_cols if c in gdf.columns), None)

    # Standardization logic
    if island_col and island_col != id_col:
        is_same_island_dup = gdf.duplicated(subset=[island_col, id_col], keep=False)
        cum_count = gdf.groupby([island_col, id_col]).cumcount() + 1
        gdf.loc[is_same_island_dup, id_col] = (
            gdf.loc[is_same_island_dup, id_col].astype(str) + " " + cum_count[is_same_island_dup].astype(str)
        )
        gdf["island_clean"] = gdf[island_col]
        gdf["name_clean"] = gdf[id_col]
    else:
        gdf["name_clean"] = gdf[id_col]
        gdf["island_clean"] = gdf[id_col] if division == "island" else "Statewide"

    available_tifs = [(d, os.path.join(local_dep_dir, dataset, f"{dataset}_{d}.tif"))
                      for d in target_dates if os.path.exists(os.path.join(local_dep_dir, dataset, f"{dataset}_{d}.tif"))]

    if not available_tifs:
        return

    records = []
    for date_str, tif in available_tifs:
        stats = zonal_stats(gdf, tif, stats="mean")

        for idx, stat in enumerate(stats):
            mean_val = stat['mean']
            if mean_val is not None:
                mean_val = mean_val / 25.4 if dataset == "rainfall" else (mean_val * 1.8) + 32

            row = gdf.iloc[idx]
            records.append({
                "island": row["island_clean"],
                "division_type": division,
                "name": row["name_clean"],
                "date": date_str.replace("_", "-"),
                "value": mean_val
            })

    df = pd.DataFrame(records)

    out_dir = f"../public/{dataset}/"
    os.makedirs(out_dir, exist_ok=True)
    out_csv = os.path.join(out_dir, f"{division}_{dataset}.csv")
    df.to_csv(out_csv, index=False)
    print(f"Saved {out_csv} ({len(df)} rows)")

def get_statewide_averages_for_dataset(dataset, target_dates, raster_folder):
    """Compute statewide mean values in long format."""
    print(f"Processing statewide for {dataset}...")

    records = []
    for date_str in target_dates:
        tif_path = os.path.join(raster_folder, dataset, f"{dataset}_{date_str}.tif")

        if os.path.exists(tif_path):
            with rasterio.open(tif_path) as src:
                arr = src.read(1).astype(float)
                if src.nodata is not None:
                    arr = np.where(arr == src.nodata, np.nan, arr)

                mean_val = np.nanmean(arr)
                if not np.isnan(mean_val):
                    mean_val = mean_val / 25.4 if dataset == "rainfall" else (mean_val * 1.8) + 32

                records.append({
                    "island": "Statewide",
                    "division_type": "statewide",
                    "name": "Statewide",
                    "date": date_str.replace("_", "-"),
                    "value": mean_val
                })

    df = pd.DataFrame(records)
    out_dir = f"../public/{dataset}/"
    os.makedirs(out_dir, exist_ok=True)
    out_csv = os.path.join(out_dir, f"statewide_{dataset}.csv")
    df.to_csv(out_csv, index=False)
    print(f"Saved {out_csv}")

def generate_target_months(end_date, years=5):
    dates = []
    current_date = end_date - relativedelta(years=years)
    while current_date <= end_date:
        dates.append(current_date.strftime("%Y_%m"))
        current_date += relativedelta(months=1)
    return dates

if __name__ == "__main__":
    datasets = ["rainfall", "temperature"]
    hst = pytz.timezone('HST')

    if len(sys.argv) > 1:
        end_date = parser.parse(sys.argv[1]).astimezone(hst)
    else:
        end_date = datetime.now(hst).replace(hour=0, minute=0, second=0, microsecond=0) - relativedelta(days=1)

    target_months = generate_target_months(end_date, years=5)

    for dataset in datasets:
        get_statewide_averages_for_dataset(dataset, target_months, local_dep_dir)
        for division, id_col in DIVISION_ID_COLS.items():
            get_averages_for_dataset(division, id_col, dataset, target_months, local_dep_dir)
