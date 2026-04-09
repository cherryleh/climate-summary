from calendar import month

from dateutil import parser
import os
import glob
from matplotlib.dates import relativedelta
import pandas as pd
import numpy as np
import geopandas as gpd
import rasterio
from urllib.parse import urlencode
from datetime import datetime
from rasterstats import zonal_stats
import pytz
import sys
import gc
import json

API_KEY = os.environ.get('HCDP_API_TOKEN')
local_dep_dir = os.environ.get('DEPENDENCY_DIR')
output_dir = os.environ.get('OUTPUT_DIR')

def convert_units(value, dataset):
    """Convert rainfall mm to inches and temperature C to F"""
    if value is None or np.isnan(value):
        return np.nan
    if dataset == "rainfall":
        return value / 25.4
    elif dataset == "temperature":
        return (value * 9/5) + 32
    return value

def make_ytd(year, month):
  input_dir = os.path.join(local_dep_dir, "rainfall")
  first_file = os.path.join(input_dir, f"rainfall_{year}_01.tif")

  if not os.path.exists(first_file):
      print(f"Warning: Missing starting file {first_file} for YTD calculation.")
      return None

  with rasterio.open(first_file) as src:
      meta = src.meta.copy()
      first_data = src.read(1, masked=True)
      land_mask = first_data.mask
      ytd_sum = np.zeros(first_data.shape, dtype='float32')

  for m in range(1, month + 1):
      file_path = os.path.join(input_dir, f"rainfall_{year}_{m:02d}.tif")
      if os.path.exists(file_path):
          with rasterio.open(file_path) as src:
              data = src.read(1).astype('float32')
              # Safeguard against nodata values being added to the sum
              if src.nodata is not None:
                  data[data == src.nodata] = 0
              ytd_sum += data

  # Re-apply the mask with standard nodata
  ytd_sum[land_mask] = -9999

  meta.update(dtype='float32', nodata=-9999)
  output_path = os.path.join(input_dir, f'YTD_{year}_{month:02d}.tif')

  with rasterio.open(output_path, 'w', **meta) as dst:
      dst.write(ytd_sum, 1)

  return output_path

def get_stats(division, dataset, year, month):
    """Compute rainfall or temperature statistics for a island or division shapefile."""
    print(f"\n--- Processing {division} - {dataset} ---")

    shapefile = os.path.join(local_dep_dir, f"shapefiles/{division}.shp")
    climo_file = os.path.join(local_dep_dir, f"climo/{dataset}/{dataset}_1991-2020_{month:02d}.tif")


    gdf = gpd.read_file(shapefile).copy()

    island_col = next((c for c in gdf.columns if c.lower() in ["island", "mokupuni", "isle", "islandname"]), None)
    name_col = next((c for c in gdf.columns if c.lower() in ["name", "division", "moku", "climate_div", "ahupuaa", "county", "name_hwn"]), None)

    gdf['geometry'] = gdf['geometry'].simplify(tolerance=0.001, preserve_topology=True)

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
    for tif in sorted(glob.glob(os.path.join(local_dep_dir, dataset, f"{dataset}_*_{month:02d}.tif"))):
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
        del stats
        gc.collect()


    df = pd.DataFrame(all_records)
    if "division_full" not in df.columns:
        raise ValueError("division_full column missing from records dataframe")

    df["rank"] = df.groupby("division_full")["anomaly"].rank(method="min")
    latest_df = df[df["date"] == f"{year}-{month:02d}"].reset_index(drop=True)

    if dataset == "rainfall":
      current_ytd_path = make_ytd(year, month)
      climo_ytd_path = os.path.join(local_dep_dir, "climo", "rainfall_ytd", f"YTD_rain_month_{month:02d}.tif")

      current_ytd_zs = zonal_stats(vectors=gdf, raster=current_ytd_path, stats=["mean"], nodata=-9999)
      climo_ytd_zs = zonal_stats(vectors=gdf, raster=climo_ytd_path, stats=["mean"], nodata=-9999)

      ytd_pnormals = []
      # Zip lets us loop through both lists at the same time
      for curr, climo in zip(current_ytd_zs, climo_ytd_zs):
          curr_mean = curr['mean']
          climo_mean = climo['mean']

          # Prevent division by zero and handle missing data (None)
          if curr_mean is not None and climo_mean is not None and climo_mean != 0:
              pnormal = (curr_mean / climo_mean) * 100
          else:
              pnormal = np.nan

          ytd_pnormals.append(pnormal)

      latest_df["ytd_pnormal"] = ytd_pnormals

    out_csv = os.path.join(output_dir, f"{division}_{dataset}_stats.csv")
    latest_df.to_csv(out_csv, index=False)
    print(f"Saved {out_csv}")

def get_statewide_stats(dataset, year, month):
    """Compute statewide mean, anomaly, percent change, and drought percentage."""
    climo_file = climo_file = os.path.join(local_dep_dir, f"climo/{dataset}/{dataset}_1991-2020_{month:02d}.tif")

    print(f"\n--- Processing statewide ({dataset}) ---")

    # Load climo
    with rasterio.open(climo_file) as src:
        clim = src.read(1).astype(float)
        clim = np.where(src.nodata == src.read(1), np.nan, clim)
        climo_mean = convert_units(np.nanmean(clim), dataset)

    # Loop through historical
    all_records = []
    for tif in sorted(glob.glob(os.path.join(local_dep_dir, dataset, f"{dataset}_*_{month:02d}.tif"))):
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
    num_rows = len(df)
    latest = df[df["date"] == f"{year}-{month:02d}"].copy()
    if latest.empty:
        print(f"No data found for {year_value}-{month:02d}")
        return

    if dataset == "rainfall":
      current_ytd_path = make_ytd(year, month)
      climo_ytd_path = os.path.join(local_dep_dir, "climo", "rainfall_ytd", f"YTD_rain_month_{month:02d}.tif")

      # Read current YTD statewide average
      with rasterio.open(current_ytd_path) as src:
          curr_arr = src.read(1).astype(float)
          curr_arr = np.where(curr_arr == -9999, np.nan, curr_arr) # Handle nodata
          curr_mean = np.nanmean(curr_arr)

      # Read climo YTD statewide average
      with rasterio.open(climo_ytd_path) as src:
          climo_arr = src.read(1).astype(float)
          climo_arr = np.where(climo_arr == -9999, np.nan, climo_arr) # Handle nodata
          climo_mean = np.nanmean(climo_arr)

      # Calculate percent normal
      if not np.isnan(curr_mean) and not np.isnan(climo_mean) and climo_mean != 0:
          pnormal = (curr_mean / climo_mean) * 100
      else:
          pnormal = np.nan

      latest["ytd_pnormal"] = pnormal

    latest["division_full"] = "Statewide"
    # latest["dry_pct"] = dry_pct

    out_csv = os.path.join(output_dir, f"statewide_{dataset}_stats.csv")
    latest.to_csv(out_csv, index=False)
    print(f"Saved {out_csv}")
    return num_rows

def export_metadata(date, stats_dict):
  produced = datetime.now(hst).replace(microsecond=0).isoformat()

  # Base metadata
  data = {
      "date": date.isoformat(),
      "produced": produced
  }

  # Merge the row counts into the data dictionary
  data.update(stats_dict)

  json_path = os.path.join(output_dir, "metadata.json")

  with open(json_path, 'w', encoding='utf-8') as f:
      json.dump(data, f, indent=4)

  print(f"Metadata saved to {json_path}")


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
      today = today.replace(hour=0, minute=0, second=0, microsecond=0)
      date = today - relativedelta(days=1)

  month_value = date.month
  year_value = date.year

  # Dictionary to store num_rows for each dataset
  num_rows_dict = {}

  for dataset in datasets:
      try:
          # Capture the return value in the dictionary
          count = get_statewide_stats(dataset, year_value, month_value)
          num_rows_dict[f"num_rows_{dataset}"] = count
      except Exception as e:
          print(f"Error processing statewide ({dataset}): {e}")
          num_rows_dict[f"num_rows_{dataset}"] = None

  for division in divisions:
      for dataset in datasets:
          try:
              get_stats(division, dataset, year_value, month_value)
          except Exception as e:
              print(f"Error processing {division} ({dataset}): {e}")

  # Pass the dictionary instead of a single integer
  export_metadata(date, num_rows_dict)
