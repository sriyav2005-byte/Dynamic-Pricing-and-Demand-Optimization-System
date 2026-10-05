"""
services/weather.py — 7-day weather outlook for a store (Open-Meteo, no API key).

Weather is shown as planning context. It is NOT a demand-model input: the
sales history has no linked historical weather, so no weather→demand effect
can be estimated yet. The response states this explicitly.
"""

from __future__ import annotations

import httpx

from app.config import get_settings
from app.services import data

WMO = {0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog",
       51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
       71: "Light snow", 73: "Snow", 75: "Heavy snow", 80: "Rain showers", 81: "Heavy showers", 82: "Violent showers",
       95: "Thunderstorm", 96: "Thunderstorm, hail", 99: "Severe thunderstorm"}


async def outlook(store_id: str) -> dict:
    st = data.store(store_id)
    if st is None:
        raise LookupError("store not found")
    s = get_settings()
    lat, lon = st.get("latitude"), st.get("longitude")
    located = lat is not None and lon is not None
    if not located:
        lat, lon = s.store_lat, s.store_lon
    url = "https://api.open-meteo.com/v1/forecast"
    params = {"latitude": lat, "longitude": lon, "timezone": st.get("timezone") or "Asia/Kolkata", "forecast_days": 7,
              "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code"}
    note = ("Weather is shown for planning only; it is not used by the demand model because no historical weather "
            "is linked to the sales history.")
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(url, params=params)
            r.raise_for_status()
            d = r.json()["daily"]
    except Exception as exc:
        return {"status": "UNAVAILABLE", "error": str(exc), "days": [], "note": note}
    days = []
    for i, day in enumerate(d["time"]):
        code = d["weather_code"][i]
        days.append({"date": day, "t_max": d["temperature_2m_max"][i], "t_min": d["temperature_2m_min"][i],
                     "precipitation_mm": d["precipitation_sum"][i],
                     "precipitation_probability": (d.get("precipitation_probability_max") or [None] * 7)[i],
                     "code": code, "summary": WMO.get(code, "Unknown")})
    return {"status": "LIVE", "source": "Open-Meteo", "location": {"lat": lat, "lon": lon, "store_located": located,
            "city": st.get("city")}, "days": days, "note": note}
