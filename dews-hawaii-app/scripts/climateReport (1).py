import requests

token = "token"


headers = {
    "Authorization": f"Bearer {token}"
}


body = {
    "email": "mcleanj@hawaii.edu",
    "county": ["hawaii", "honolulu"],
    "moku": ["wahiawa"]
}

url = "https://api.hcdp.ikewai.org/mesonet/climate_report/subscribe"
res = requests.post(url, json = body, headers = headers)
res.raise_for_status()
print("User subscribed")

params = {
  "email": "mcleanj@hawaii.edu"
}
url = "https://api.hcdp.ikewai.org/mesonet/climate_report/email_lookup"
res = requests.get(url, json = body, params = params, headers = headers)
res.raise_for_status()
data = res.json()
print("Retreives the user ID")
print(data)

# Save the user ID for future queries
userID = data["userID"]

params = {
  "email": "dne@hawaii.edu"
}
res = requests.get(url, json = body, params = params, headers = headers)
res.raise_for_status()
print("User does not exist, UserID will be null")
print(res.json())


url = f"https://api.hcdp.ikewai.org/mesonet/climate_report/subscription/{userID}"
res = requests.get(url, headers = headers)
res.raise_for_status()
print("Show user data")
print(res.json())


body = {
    "moku": [],
    "ahupuaa": ["kailua", "nanakuli", "waikiki"],
    "watershed": ["ewa"]
}
# This will update any fields in the body of the request (moku, ahupuaa, and watershed in this case)
url = f"https://api.hcdp.ikewai.org/mesonet/climate_report/subscription/{userID}"
res = requests.patch(url, json = body, headers = headers)
res.raise_for_status()
print("Subscription updated")

url = f"https://api.hcdp.ikewai.org/mesonet/climate_report/subscription/{userID}"
res = requests.get(url, headers = headers)
res.raise_for_status()
print("User data has been updated")
print(res.json())

# token must have meso_admin permissions, note admin token should not be used in public site
url = "https://api.hcdp.ikewai.org/mesonet/climate_report/subscriptions"
res = requests.get(url, headers = headers)
res.raise_for_status()
print("Shows an array of all subscriptions (admin only)")
print(res.json())

# Uncomment this section to email the user
# This is also an admin endpoint
# The should be replaced with your generated climate report content and will be wrapped in some additional text on the API end

report_email_content_text = "This is a test message\nThis will be populated with your climate report content"
report_email_content_html = "<div><p>This is a test message<br/>This will be populated with your climate report content</p><div style='color:purple;font-weight:bold;font-size:24px;'>Most email clients will use HTML content and this can be formatted however you want</div></div>"
body = {
  "text": report_email_content_text,
  "html": report_email_content_html
}
url = f"https://api.hcdp.ikewai.org/mesonet/climate_report/subscription/{userID}/email"
res = requests.post(url, json = body, headers = headers)
res.raise_for_status()
print("User has been sent an email")
print(res.json())


# I would recommend providing an unsubscribe link with the user ID that goes to an offshoot of your site that submits the unsubscribe request and reports its status
url = f"https://api.hcdp.ikewai.org/mesonet/climate_report/subscription/{userID}/unsubscribe"
res = requests.patch(url, headers = headers)
res.raise_for_status()
print("User unsubscribed")

# Should show null for the user ID (technically the user still exists in the database but will not show up in queries, resubscribing will leave them with the same UUID)
params = {
  "email": "mcleanj@hawaii.edu"
}
url = "https://api.hcdp.ikewai.org/mesonet/climate_report/email_lookup"
res = requests.get(url, json = body, params = params, headers = headers)
res.raise_for_status()
data = res.json()
print("User no longer shows up in queries")
print(data)