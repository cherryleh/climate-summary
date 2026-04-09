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
    Compute mean values per polygon for a specific dataset over a list of target dates.
    Exports to a CSV with a pivoted date format.
    """
    print(f"Processing {division} for {dataset}...")

    shp_path = os.path.join(local_dep_dir, f"shapefiles/{division}.shp")
    if not os.path.exists(shp_path):
        print(f"Shapefile not found: {shp_path}")
        return

    gdf = gpd.read_file(shp_path).reset_index(drop=True)

    possible_island_cols = ["island", "ISLAND", "mokupuni", "Mokupuni", "isle", ]
    island_col = next((c for c in possible_island_cols if c in gdf.columns), None)

    if island_col and island_col != id_col:
        is_same_island_dup = gdf.duplicated(subset=[island_col, id_col], keep=False)

        cum_count = gdf.groupby([island_col, id_col]).cumcount() + 1

        gdf.loc[is_same_island_dup, id_col] = (
            gdf.loc[is_same_island_dup, id_col].astype(str) + " " + cum_count[is_same_island_dup].astype(str)
        )

        # 4. Create the final identifier string
        gdf["division_full"] = gdf.apply(
            lambda r: f"{r[island_col]}::{r[id_col]}" if pd.notna(r[island_col]) else str(r[id_col]),
            axis=1
        )
    else:
        gdf["division_full"] = gdf[id_col].astype(str)

    # Filter for rasters that actually exist in the 5-year target range
    available_tifs = []
    for date_str in target_dates:
        tif_path = os.path.join(local_dep_dir, dataset, f"{dataset}_{date_str}.tif")

        if os.path.exists(tif_path):
            available_tifs.append((date_str, tif_path))

    if not available_tifs:
        print(f"No {dataset} rasters found for {division} in the last 5 years.")
        return

    with rasterio.open(available_tifs[0][1]) as src:
        raster_crs = src.crs

    records = []
    for date_str, tif in available_tifs:
        stats = zonal_stats(gdf, tif, stats="mean")

        for div, stat in zip(gdf["division_full"], stats):
            mean_val = stat['mean']
            if mean_val is not None:
                if dataset == "rainfall":
                    mean_val = mean_val / 25.4 # mm to inches
                elif dataset == "temperature":
                    mean_val = (mean_val * 1.8) + 32 # Celsius to Fahrenheit
            else:
                mean_val = np.nan

            records.append({"division": div, "date": date_str.replace("_", "-"), f"mean_{dataset}": mean_val})

    if not records:
        print("No data extracted.")
        return

    df = (
        pd.DataFrame(records)
        .groupby(["division", "date"])[f"mean_{dataset}"]
        .mean()
        .reset_index()
        .pivot(index="division", columns="date", values=f"mean_{dataset}")
    )

    df = df.reindex(sorted(df.columns), axis=1)

    out_dir = f"../public/{dataset}/"
    os.makedirs(out_dir, exist_ok=True)

    out_csv = os.path.join(out_dir, f"{division}_{dataset}.csv")
    df.to_csv(out_csv)
    print(f"Saved {out_csv} ({len(df)} rows)")

def get_statewide_averages_for_dataset(dataset, target_dates, raster_folder):
    """
    Compute mean values for the entire state (raster-wide) for a specific dataset.
    Exports to a CSV with a pivoted date format.
    """
    print(f"Processing statewide for {dataset}...")

    records = []
    for date_str in target_dates:
        tif_path = os.path.join(raster_folder, dataset, f"{dataset}_{date_str}.tif")

        if os.path.exists(tif_path):
            with rasterio.open(tif_path) as src:
                arr = src.read(1).astype(float)
                # Handle nodata to avoid skewing the mean
                if src.nodata is not None:
                    arr = np.where(arr == src.nodata, np.nan, arr)

                mean_val = np.nanmean(arr)

                if not np.isnan(mean_val):
                    if dataset == "rainfall":
                        mean_val = mean_val / 25.4  # mm to inches
                    elif dataset == "temperature":
                        mean_val = (mean_val * 1.8) + 32  # Celsius to Fahrenheit

                records.append({"division": "Statewide", "date": date_str.replace("_", "-"), f"mean_{dataset}": mean_val})

    if not records:
        print(f"No {dataset} rasters found for statewide extraction in the last 5 years.")
        return

    df = (
        pd.DataFrame(records)
        .pivot(index="division", columns="date", values=f"mean_{dataset}")
    )

    df = df.reindex(sorted(df.columns), axis=1)

    out_dir = f"../public/{dataset}/"
    os.makedirs(out_dir, exist_ok=True)

    out_csv = os.path.join(out_dir, f"statewide_{dataset}.csv")
    df.to_csv(out_csv)
    print(f"Saved {out_csv} ({len(df)} rows)")

def generate_target_months(end_date, years=5):
  """Generates a list of 'YYYY_MM' strings for the past `years` from end_date."""
  dates = []
  # Start loop from exactly 5 years ago, up to the end_date month
  current_date = end_date - relativedelta(years=years)

  while current_date <= end_date:
      dates.append(current_date.strftime("%Y_%m"))
      current_date += relativedelta(months=1)

  return dates


if __name__ == "__main__":
    datasets = ["rainfall", "temperature"]
    hst = pytz.timezone('HST')

    # Determine end date
    if len(sys.argv) > 1:
        input_date = sys.argv[1]
        end_date = parser.parse(input_date).astimezone(hst)
    else:
        today = datetime.now(hst)
        today = today.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = today - relativedelta(days=1)

    # Generate the YYYY_MM list for the last 5 years
    target_months = generate_target_months(end_date, years=5)
    print(f"Executing stats from {target_months[0]} to {target_months[-1]}...")

    # Process everything
    for dataset in datasets:
        # 1. Process Statewide First
        try:
            get_statewide_averages_for_dataset(
                dataset=dataset,
                target_dates=target_months,
                raster_folder=local_dep_dir
            )
        except Exception as e:
            print(f"Error processing statewide ({dataset}): {e}")

        # 2. Process Divisions
        for division, id_col in DIVISION_ID_COLS.items():
            try:
                get_averages_for_dataset(
                    division=division,
                    id_col=id_col,
                    dataset=dataset,
                    target_dates=target_months,
                    raster_folder=local_dep_dir
                )
            except Exception as e:
                print(f"Error processing {division} ({dataset}): {e}")

    print("5-Year extraction complete.")
