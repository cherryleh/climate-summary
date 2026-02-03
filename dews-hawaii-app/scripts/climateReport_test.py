#initial subscription
body = {
    "email": "cherryle@hawaii.edu",
    "county": ["honolulu"],
    "moku": ["wahiawa"]
}

url = "https://api.hcdp.ikewai.org/mesonet/climate_report/subscribe"
res = requests.post(url, json = body, headers = headers)
res.raise_for_status()
print("User subscribed")

#additional subscription, append to existing settings
new_body = {
    "email": "cherryle@hawaii.edu",
    "county": ["hawaii"]
}

url = f"https://api.hcdp.ikewai.org/mesonet/climate_report/subscription/{userID}"
res = requests.patch(url, json = body, headers = headers)
res.raise_for_status()
print("Subscription updated")

url = "https://api.hcdp.ikewai.org/mesonet/climate_report/subscriptions"
res = requests.get(url, headers = headers)
res.raise_for_status()
print("Shows an array of all subscriptions (admin only)")
print(res.json())