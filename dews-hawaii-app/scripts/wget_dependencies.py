import os
import sys
import pytz
import requests
import pandas as pd
from datetime import datetime
from dateutil.relativedelta import relativedelta
from os.path import join
import time
import calendar

# Ensure these are set in your environment!
hcdp_api_token = os.environ.get('HCDP_API_TOKEN')
local_dep_dir = os.environ.get('DEPENDENCY_DIR', './') # Default to current directory if not set


datasets = [
    ({"datatype": "rainfall", "production": "legacy"}, "rainfall_legacy"),
    ({"datatype": "rainfall", "production": "new"}, "rainfall_new"),
    ({"datatype": "temperature", "aggregation":"mean"}, "temperature"),
    ({"datatype": "spi", "timescale": "timescale003"}, "spi3")
]

def dataset2params(dataset):
    return "&".join("=".join(item) for item in dataset.items())

def get_raster(date_str, dataset_dict, outf):
    """Fetches raster data from HCDP API with built-in retries for timeouts."""
    url = f"https://api.hcdp.ikewai.org/raster?period=month&date={date_str}&extent=statewide&{dataset2params(dataset_dict)}"
    print(url)
    headers = {'Authorization': f'Bearer {hcdp_api_token}'}
    found = False
    res = requests.get(url, headers=headers)
    if res.status_code != 404:
        res.raise_for_status()
        with open(outf, 'wb') as f:
            f.write(res.content)
        found = True
    return found

def fetch_tifs(dataset_prefix, dataset_dict, start_year, end_year, month):
  for year in range(start_year, end_year + 1):
    date_str = f"{year}-{month:02d}"
    filename = f"{dataset_prefix}_{year}_{month:02d}.tif"
    outf = join(local_dep_dir, dataset_prefix, filename)

    if os.path.exists(outf):
        print(f"Skipping {date_str} (File already exists)")
        continue

    print(f"Fetching: {date_str} ({dataset_prefix})")
    success = get_raster(date_str, dataset_dict, outf)


if __name__ == "__main__":
  hst = pytz.timezone('HST')
  date = None

  if len(sys.argv) > 1:
      from dateutil import parser # Ensure this is imported!
      input_date = sys.argv[1]
      date = parser.parse(input_date).astimezone(hst)
  else:
      today = datetime.now(hst)
      today = today.replace(hour=0, minute=0, second=0, microsecond=0)
      date = today - relativedelta(days=1)

  month_value = date.month
  year_value = date.year

  print(f"Target Date: {date.strftime('%Y-%m-%d')}")
  print(f"Fetching all historical data for Month: {month_value:02d}")

  # 1. Fetch Legacy Rainfall (1920 - 1989) for this specific month
  fetch_tifs(
      dataset_prefix="rainfall",
      dataset_dict=datasets[0][0],
      start_year=1920,
      end_year=1989,
      month=month_value
  )

  # 2. Fetch New Rainfall (1990 - target year) for this specific month
  fetch_tifs(
      dataset_prefix="rainfall",
      dataset_dict=datasets[1][0],
      start_year=1990,
      end_year=year_value,
      month=month_value
  )

  # 3. Fetch Temperature (Assuming 1990 - target year) for this specific month
  fetch_tifs(
      dataset_prefix="temperature",
      dataset_dict=datasets[2][0],
      start_year=1990,
      end_year=year_value,
      month=month_value
  )

  fetch_tifs(
      dataset_prefix="spi3",
      dataset_dict=datasets[3][0],
      start_year=year_value,
      end_year=year_value,
      month=month_value
  )

  # Get monthly tifs for the last five years
  start_year_5yr = year_value - 5

  for yr in range(start_year_5yr, year_value + 1):
      for mo in range(1, 13):
          # Skip future months if we are looking at the current year
          if yr == year_value and mo > month_value:
              continue

          # Fetch Rainfall New (Post-1990)
          fetch_tifs(
              dataset_prefix="rainfall",
              dataset_dict=datasets[1][0],
              start_year=yr,
              end_year=yr,
              month=mo
          )

          # Fetch Temperature
          fetch_tifs(
              dataset_prefix="temperature",
              dataset_dict=datasets[2][0],
              start_year=yr,
              end_year=yr,
              month=mo
          )

  #Fetch spi3

