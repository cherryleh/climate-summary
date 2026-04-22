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
                if src.nodata is not None:
                    data[data == src.nodata] = 0
                ytd_sum += data

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
        is_same_island_dup = gdf.duplicated(subset=[island_col, name_col], keep=False)
        cum_count = gdf.groupby([island_col, name_col]).cumcount() + 1
        gdf.loc[is_same_island_dup, name_col] = (
            gdf.loc[is_same_island_dup, name_col].astype(str) + " " + cum_count[is_same_island_dup].astype(str)
        )
        gdf = gdf.dissolve(by=[island_col, name_col], as_index=False)
        gdf["division_full"] = gdf.apply(lambda r: f"{r[island_col]}::{r[name_col]}", axis=1)
    elif name_col:
        gdf = gdf.dissolve(by=name_col, as_index=False)
        gdf["division_full"] = gdf[name_col].astype(str)
    else:
        raise ValueError(f"No valid name column found in {division}.shp")

    climo_zs = zonal_stats(vectors=gdf, raster=climo_file, stats=["mean"], nodata=None)
    gdf["climo_mean"] = [convert_units(c["mean"], dataset) for c in climo_zs]

    all_records = []
    for tif in sorted(glob.glob(os.path.join(local_dep_dir, dataset, f"{dataset}_*_{month:02d}.tif"))):
        parts = os.path.basename(tif).replace(".tif", "").split("_")
        curr_year, curr_month = parts[1], parts[2]
        curr_date = f"{curr_year}-{curr_month}"

        stats_to_compute = ["mean", "max"] if dataset == "temperature" else ["mean"]
        stats = zonal_stats(vectors=gdf, raster=tif, stats=stats_to_compute, nodata=None)

        for idx, row in gdf.iterrows():
            mean_raw = stats[idx]["mean"]

            if mean_raw is None or np.isnan(mean_raw):
                mean_val, anomaly, pchange = np.nan, np.nan, np.nan
                if dataset == "temperature":
                    max_val = np.nan
            else:
                mean_val = convert_units(mean_raw, dataset)
                climo_mean = row["climo_mean"]
                if np.isnan(climo_mean):
                    anomaly, pchange = np.nan, np.nan
                else:
                    anomaly = mean_val - climo_mean
                    pchange = ((mean_val - climo_mean) / climo_mean) * 100 if dataset == "rainfall" else anomaly

                if dataset == "temperature":
                    max_raw = stats[idx].get("max")
                    max_val = convert_units(max_raw, dataset) if max_raw is not None else np.nan

            record = {
                "division_full": row["division_full"],
                "date": curr_date,
                "mean": mean_val,
                "anomaly": anomaly,
                "pchange": pchange,
            }

            if dataset == "temperature":
                record["max"] = max_val

            all_records.append(record)

        del stats
        gc.collect()

    df = pd.DataFrame(all_records)
    if "division_full" not in df.columns:
        raise ValueError("division_full column missing from records dataframe")

    df["rank"] = df.groupby("division_full")["anomaly"].rank(method="min", ascending=False)
    latest_df = df[df["date"] == f"{year}-{month:02d}"].reset_index(drop=True)

    if dataset == "rainfall":
        current_ytd_path = make_ytd(year, month)
        climo_ytd_path = os.path.join(local_dep_dir, "climo", "rainfall_ytd", f"YTD_rain_month_{month:02d}.tif")

        current_ytd_zs = zonal_stats(vectors=gdf, raster=current_ytd_path, stats=["mean"], nodata=-9999)
        climo_ytd_zs = zonal_stats(vectors=gdf, raster=climo_ytd_path, stats=["mean"], nodata=-9999)

        ytd_pnormals = []
        for curr, climo in zip(current_ytd_zs, climo_ytd_zs):
            curr_mean = curr['mean']
            climo_mean = climo['mean']

            if curr_mean is not None and climo_mean is not None and climo_mean != 0:
                pnormal = (curr_mean / climo_mean) * 100
            else:
                pnormal = np.nan

            ytd_pnormals.append(pnormal)

        latest_df["ytd_pnormal"] = ytd_pnormals

    base_cols = ["division_full", "date", "mean", "anomaly", "pchange", "rank"]

    if dataset == "rainfall":
        base_cols.append("ytd_pnormal")
    elif dataset == "temperature":
        base_cols.append("max")

    latest_df = latest_df[base_cols]

    out_csv = os.path.join(output_dir, dataset, f"{division}_{dataset}_stats.csv")
    latest_df.to_csv(out_csv, index=False)
    print(f"Saved {out_csv}")

def get_statewide_stats(dataset, year, month):
    """Compute statewide mean, anomaly, percent change, and drought percentage."""
    climo_file = os.path.join(local_dep_dir, f"climo/{dataset}/{dataset}_1991-2020_{month:02d}.tif")

    print(f"\n--- Processing statewide ({dataset}) ---")

    with rasterio.open(climo_file) as src:
        clim = src.read(1).astype(float)
        clim = np.where(src.nodata == src.read(1), np.nan, clim)
        climo_mean = convert_units(np.nanmean(clim), dataset)

    all_records = []
    for tif in sorted(glob.glob(os.path.join(local_dep_dir, dataset, f"{dataset}_*_{month:02d}.tif"))):
        parts = os.path.basename(tif).replace(".tif", "").split("_")
        curr_year, curr_month = parts[1], parts[2]
        curr_date = f"{curr_year}-{curr_month}"

        with rasterio.open(tif) as src:
            arr = src.read(1).astype(float)
            arr = np.where(arr == src.nodata, np.nan, arr)
            mean_val = convert_units(np.nanmean(arr), dataset)

            if dataset == "temperature":
                # Suppress the warning if the array is entirely NaNs
                with np.errstate(all='ignore'):
                    max_val = convert_units(np.nanmax(arr), dataset)

        anomaly = mean_val - climo_mean
        pchange = ((mean_val - climo_mean) / climo_mean) * 100 if dataset == "rainfall" else anomaly

        record = {
            "date": curr_date,
            "mean": mean_val,
            "anomaly": anomaly,
            "pchange": pchange,
        }
        if dataset == "temperature":
            record["max"] = max_val

        all_records.append(record)

    df = pd.DataFrame(all_records)

    df["rank"] = df["anomaly"].rank(method="min", ascending=False)
    num_rows = len(df)
    latest = df[df["date"] == f"{year}-{month:02d}"].copy()
    if latest.empty:
        print(f"No data found for {year}-{month:02d}")
        return

    if dataset == "rainfall":
        current_ytd_path = make_ytd(year, month)
        climo_ytd_path = os.path.join(local_dep_dir, "climo", "rainfall_ytd", f"YTD_rain_month_{month:02d}.tif")

        with rasterio.open(current_ytd_path) as src:
            curr_arr = src.read(1).astype(float)
            curr_arr = np.where(curr_arr == -9999, np.nan, curr_arr)
            curr_mean = np.nanmean(curr_arr)

        with rasterio.open(climo_ytd_path) as src:
            climo_arr = src.read(1).astype(float)
            climo_arr = np.where(climo_arr == -9999, np.nan, climo_arr)
            climo_mean = np.nanmean(climo_arr)

        if not np.isnan(curr_mean) and not np.isnan(climo_mean) and climo_mean != 0:
            pnormal = (curr_mean / climo_mean) * 100
        else:
            pnormal = np.nan

        latest["ytd_pnormal"] = pnormal

    latest["division_full"] = "Statewide"

    base_cols = ["division_full", "date", "mean", "anomaly", "pchange", "rank"]

    if dataset == "rainfall":
        base_cols.append("ytd_pnormal")
    elif dataset == "temperature":
        base_cols.append("max")

    latest_df = latest[base_cols]

    out_csv = os.path.join(output_dir, dataset, f"statewide_{dataset}_stats.csv")
    latest_df.to_csv(out_csv, index=False)
    print(f"Saved {out_csv}")
    return num_rows

def export_metadata(date, stats_dict):
    produced = datetime.now(hst).replace(microsecond=0).isoformat()

    data = {
        "date": date.isoformat(),
        "produced": produced
    }
    data.update(stats_dict)

    json_path = os.path.join(output_dir, "metadata.json")

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4)

    print(f"Metadata saved to {json_path}")


def get_statewide_drought_stats(year, month):
    """Compute statewide drought category percentages."""
    print(f"\n--- Processing statewide (drought) ---")

    tif_path = os.path.join(local_dep_dir, "spi3", f"spi3_cat.tif")
    if not os.path.exists(tif_path):
        print(f"Warning: Missing drought file {tif_path}")
        return 0

    cat_map = {
        0: "D4", 1: "D3", 2: "D2", 3: "D1", 4: "D0",
        5: "Near Normal",
        6: "W0", 7: "W1", 8: "W2", 9: "W3", 10: "W4"
    }

    with rasterio.open(tif_path) as src:
        data = src.read(1)
        nodata = src.nodata

    valid_mask = (data != nodata)
    valid_data = data[valid_mask]
    total_pixels = valid_data.size

    record = {
        "date": f"{year}-{month:02d}",
        "division_full": "Statewide"
    }

    if total_pixels > 0:
        unique, counts = np.unique(valid_data, return_counts=True)
        counts_dict = dict(zip(unique, counts))

        for val, code in cat_map.items():
            count = counts_dict.get(val, 0)
            record[code] = (count / total_pixels) * 100
    else:
        for val, code in cat_map.items():
            record[code] = np.nan

    df = pd.DataFrame([record])
    drought_cols = [
        "division_full", "date",
        "D4", "D3", "D2", "D1", "D0",
        "Near Normal",
        "W0", "W1", "W2", "W3", "W4"
    ]

    df = df[drought_cols]

    # Fixed: Changed {division} to "statewide"
    out_csv = os.path.join(output_dir, "spi", "statewide_drought_stats.csv")
    df.to_csv(out_csv, index=False)
    print(f"Saved {out_csv}")

    return len(df)

def get_drought_stats(division, year, month):
    """Compute percentage of pixels in each SPI category for divisions."""
    print(f"\n--- Processing {division} - drought ---")

    shapefile = os.path.join(local_dep_dir, f"shapefiles/{division}.shp")
    tif_path = os.path.join(local_dep_dir, "spi3", f"spi3_cat.tif")

    if not os.path.exists(tif_path):
        print(f"Warning: Missing drought file {tif_path}")
        return

    cat_map = {
        0: "D4", 1: "D3", 2: "D2", 3: "D1", 4: "D0",
        5: "Near Normal",
        6: "W0", 7: "W1", 8: "W2", 9: "W3", 10: "W4"
    }

    gdf = gpd.read_file(shapefile).copy()
    island_col = next((c for c in gdf.columns if c.lower() in ["island", "mokupuni", "isle", "islandname"]), None)
    name_col = next((c for c in gdf.columns if c.lower() in ["name", "division", "moku", "climate_div", "ahupuaa", "county", "name_hwn"]), None)

    gdf['geometry'] = gdf['geometry'].simplify(tolerance=0.001, preserve_topology=True)

    if island_col and name_col:
        is_same_island_dup = gdf.duplicated(subset=[island_col, name_col], keep=False)
        cum_count = gdf.groupby([island_col, name_col]).cumcount() + 1
        gdf.loc[is_same_island_dup, name_col] = (
            gdf.loc[is_same_island_dup, name_col].astype(str) + " " + cum_count[is_same_island_dup].astype(str)
        )
        gdf = gdf.dissolve(by=[island_col, name_col], as_index=False)
        gdf["division_full"] = gdf.apply(lambda r: f"{r[island_col]}::{r[name_col]}", axis=1)
    elif name_col:
        gdf = gdf.dissolve(by=name_col, as_index=False)
        gdf["division_full"] = gdf[name_col].astype(str)
    else:
        raise ValueError(f"No valid name column found in {division}.shp")

    with rasterio.open(tif_path) as src:
        nodata = src.nodata

    zs = zonal_stats(gdf, tif_path, categorical=True, nodata=nodata)

    all_records = []
    for i, stats in enumerate(zs):
        division_name = gdf.iloc[i]["division_full"]
        total = sum(stats.values()) if stats else 0

        record = {
            "date": f"{year}-{month:02d}",
            "division_full": division_name,
        }

        for val, code in cat_map.items():
            count = stats.get(val, 0) if stats else 0
            pct = (count / total) * 100 if total > 0 else np.nan
            record[code] = pct

        all_records.append(record)

    df = pd.DataFrame(all_records)

    drought_cols = [
        "division_full", "date",
        "D4", "D3", "D2", "D1", "D0",
        "Near Normal",
        "W0", "W1", "W2", "W3", "W4"
    ]

    df = df[drought_cols]

    out_csv = os.path.join(output_dir, "spi", f"{division}_drought_stats.csv")
    df.to_csv(out_csv, index=False)

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
        today = today.replace(hour=0, minute=0, second=0, microsecond=0)
        date = today - relativedelta(months=1)

    month_value = date.month
    year_value = date.year

    num_rows_dict = {}

    for dataset in datasets:
        try:
            count = get_statewide_stats(dataset, year_value, month_value)
            num_rows_dict[f"num_rows_{dataset}"] = count
        except Exception as e:
            print(f"Error processing statewide ({dataset}): {e}")
            num_rows_dict[f"num_rows_{dataset}"] = None
    try:
        count = get_statewide_drought_stats(year_value, month_value)
        num_rows_dict["num_rows_drought"] = count
    except Exception as e:
        print(f"Error processing statewide (drought): {e}")
        num_rows_dict["num_rows_drought"] = None

    for division in divisions:
        for dataset in datasets:
            try:
                get_stats(division, dataset, year_value, month_value)
            except Exception as e:
                print(f"Error processing {division} ({dataset}): {e}")
            try:
                get_drought_stats(division, year_value, month_value)
            except Exception as e:
                print(f"Error processing {division} (drought): {e}")

    export_metadata(date, num_rows_dict)
