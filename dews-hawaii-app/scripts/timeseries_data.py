import pandas as pd
import requests
import geopandas as gpd
from rasterstats import zonal_stats
import os, glob
import rasterio
import numpy as np
from rasterio.features import rasterize
from datetime import datetime
from dateutil.relativedelta import relativedelta
import re

raster_folder = "./data"


def get_key_from_environment(file_path: str, key: str) -> str | None:
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Regex to match key: 'value' or key: "value"
    pattern = rf'{key}\s*:\s*[\'"]([^\'"]+)[\'"]'
    match = re.search(pattern, content)

    return match.group(1) if match else None


# Example usage
file_path = "../src/environments/environment.ts"
api_key = get_key_from_environment(file_path, "apiToken")

def get_tifs(scale):
    header = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    start_date = datetime(2020, 9, 1)   # Sept 2024
    end_date = datetime(2025, 8, 1)     # Aug 2025

    # Loop over months
    date = start_date
    while date <= end_date:
        date_str = date.strftime("%Y-%m")
        url = f"{url}date={date_str}"
        res = requests.get(url, headers=header)
            
        if res.status_code == 200:
            file = f"./data/spi{scale:03d}_{date_str}.tif"
            with open(file, "wb") as f:
                f.write(res.content)
            
        # Move to next month
        date += relativedelta(months=1)

drought_url = f"https://api.hcdp.ikewai.org/raster?datatype=spi&period=month&timescale=timescale{scale:03d}&"
rf_url = f"https://api.hcdp.ikewai.org/raster?datatype=spi&period=month&timescale=timescale{scale:03d}&"