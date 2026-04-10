import os
import sys
from matplotlib.dates import relativedelta
import numpy as np
import pytz
import rasterio
import json
from matplotlib.colors import ListedColormap
from dateutil import parser
from datetime import datetime


# Ensure these paths match your environment
LOCAL_DEP_DIR = os.environ.get('DEPENDENCY_DIR', "./data/dependencies")
OUTPUT_DIR = os.environ.get('OUTPUT_DIR', "./public/tifs")

# Ensure output directory exists
os.makedirs(OUTPUT_DIR, exist_ok=True)

def save_raster(path, data, profile):
    """Helper to write uint8 rasters with LZW compression."""
    profile.update(dtype=rasterio.uint8, count=1, compress='lzw', nodata=255)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data.astype(np.uint8), 1)
    print(f"Saved: {path}")

def process_rainfall(year, month):
  print(f"Processing Rainfall for {year}-{month:02d}...")
  climo_file = os.path.join(LOCAL_DEP_DIR, f"climo/rainfall/rainfall_1991-2020_{month:02d}.tif")
  raster_file = os.path.join(LOCAL_DEP_DIR, f"rainfall/rainfall_{year}_{month:02d}.tif")

  with rasterio.open(climo_file) as c_src, rasterio.open(raster_file) as r_src:
      rf_climo = np.ma.masked_equal(c_src.read(1), c_src.nodata)
      rf_curr = np.ma.masked_equal(r_src.read(1), r_src.nodata)
      profile = r_src.profile

  # Calculate Percent Difference
  pdiff = (rf_curr - rf_climo) / rf_climo * 100
  valid_mask = ~pdiff.mask
  data = pdiff.data
  valid_data = data[valid_mask]

  # Thresholds and Colors
  neutral_low, neutral_high = -10.0, 10.0
  n_breaks = [-70, -50, -30]
  default_p_breaks = [30, 50, 70]
  base_colors = ["#730000", "#FF0000", "#FF6600", "#FFCC66", "#FFFFFF", "#CCE5FF", "#99CCFF", "#0066CC", "#001933"]

  # Dynamic Positive Scale
  is_crazy_high = np.percentile(valid_data, 98) > 150
  p_breaks = np.percentile(valid_data[valid_data > neutral_high], [25, 50, 75]) if is_crazy_high else default_p_breaks

  bounds = [
      (-np.inf, n_breaks[0]), (n_breaks[0], n_breaks[1]), (n_breaks[1], n_breaks[2]), (n_breaks[2], neutral_low),
      (neutral_low, neutral_high),
      (neutral_high, p_breaks[0]), (p_breaks[0], p_breaks[1]), (p_breaks[1], p_breaks[2]), (p_breaks[2], np.inf)
  ]

  # Categorize Raster
  categorical = np.full(data.shape, 255, dtype=np.uint8)
  legend_items = []

  for i, (low, high) in enumerate(bounds):
      mask = valid_mask & (data >= low) & (data < high) if i < 8 else valid_mask & (data >= low)
      categorical[mask] = i

      # Build Legend Label
      if i == 0: label = f"< {high:.0f}%"
      elif i == 8: label = f"> {low:.0f}%"
      else: label = f"{low:+.0f}% to {high:+.0f}%"

      legend_items.append({
          "category_value": i,
          "color": base_colors[i],
          "label": label,
          "min": None if np.isinf(low) else float(low),
          "max": None if np.isinf(high) else float(high)
      })

  save_raster(os.path.join(OUTPUT_DIR, "tifs", "rainfall_pdiff_cat.tif"), categorical, profile)

  # JSON Legend Metadata
  is_wet_heavy = np.median(valid_data) > 0
  if is_wet_heavy:
      legend_items.reverse()

  legend_data = {
      "dataset": "rainfall",
      "year": year,
      "month": month,
      "is_wet_heavy": bool(is_wet_heavy),
      "items": legend_items
  }

  json_path = os.path.join(OUTPUT_DIR, "tifs","rainfall_legend.json")
  with open(json_path, 'w') as f:
      json.dump(legend_data, f, indent=4)
  print(f"Saved Legend: {json_path}")
def process_temperature(year, month):
    print(f"Processing Temperature for {year}-{month:02d}...")
    climo_file = os.path.join(LOCAL_DEP_DIR, f"climo/temperature/temperature_1991-2020_{month:02d}.tif")
    raster_file = os.path.join(LOCAL_DEP_DIR, f"temperature/temperature_{year}_{month:02d}.tif")

    with rasterio.open(climo_file) as c_src, rasterio.open(raster_file) as r_src:
        t_climo = c_src.read(1).astype(float)
        t_curr = r_src.read(1).astype(float)
        profile = r_src.profile
        # Combine masks
        mask = (t_climo == c_src.nodata) | (t_curr == r_src.nodata)

    diff = t_curr - t_climo
    categorical = np.full(diff.shape, 255, dtype=np.uint8)

    thresholds = [(-np.inf, -1), (-1, -0.6), (-0.6, -0.2), (-0.2, 0.2), (0.2, 0.6), (0.6, 1), (1, np.inf)]

    for i, (low, high) in enumerate(thresholds):
        cond = (~mask) & (diff > low) & (diff <= high)
        categorical[cond] = i

    save_raster(os.path.join(OUTPUT_DIR, "tifs", "temperature_diff_cat.tif"), categorical, profile)

def process_drought(year, month):
    print(f"Processing Drought (SPI3) for {year}-{month:02d}...")
    spi_file = os.path.join(LOCAL_DEP_DIR, "spi3", f"spi3_{year}_{month:02d}.tif")

    with rasterio.open(spi_file) as src:
        data = src.read(1)
        profile = src.profile
        mask = (data == src.nodata) | np.isnan(data)

    categorical = np.full(data.shape, 255, dtype=np.uint8)
    valid = ~mask

    # Define bins
    bins = [-np.inf, -2.0, -1.6, -1.3, -0.8, -0.5, 0.5, 0.8, 1.3, 1.6, 2.0, np.inf]
    for i in range(len(bins)-1):
        cond = valid & (data > bins[i]) & (data <= bins[i+1])
        categorical[cond] = i

    save_raster(os.path.join(OUTPUT_DIR, "tifs",  "spi3_cat.tif"), categorical, profile)
    #Need to save to dependencies too as this will be used for the stats calculations
    save_raster(os.path.join(LOCAL_DEP_DIR, "spi3", f"spi3_cat.tif"), categorical, profile)


if __name__ == "__main__":
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

    try:
        process_rainfall(year_value, month_value)
        process_temperature(year_value, month_value)
        process_drought(year_value, month_value)
        print("\nAll tasks completed successfully.")
    except Exception as e:
        print(f"An error occurred: {e}")
