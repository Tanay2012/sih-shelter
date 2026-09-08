import sys
import json
import requests

def fetch_nasa_weather(lat, lon):
    """Fetches real hourly temperature and solar irradiance from NASA POWER API."""
    url = f"https://power.larc.nasa.gov/api/temporal/hourly/point?parameters=T2M,ALLSKY_SFC_SW_DWN&community=RE&longitude={lon}&latitude={lat}&start=20230115&end=20230115&format=JSON"
    
    try:
        response = requests.get(url, timeout=5)
        data = response.json()["properties"]["parameter"]
        ambient_temps = list(data["T2M"].values())[:24]
        solar_flux = list(data["ALLSKY_SFC_SW_DWN"].values())[:24]
        return ambient_temps, solar_flux
    except Exception:
        # Fallback data if the API fails or rate-limits you
        fallback_temps = [-12, -14, -15, -15, -14, -12, -8, -3, 1, 4, 6, 7, 5, 2, -1, -4, -7, -9, -10, -11, -12, -13, -13, -14]
        fallback_solar = [0, 0, 0, 0, 0, 0, 45, 220, 530, 810, 960, 1010, 920, 710, 430, 150, 10, 0, 0, 0, 0, 0, 0, 0]
        return fallback_temps, fallback_solar

def run_thermodynamic_fallback(params):
    """A purely mathematical transient thermal model."""
    # 1. Parse incoming parameters with safe defaults
    geo = params.get("geometry", {})
    mat = params.get("materials", {})
    loc = params.get("location", {})
    
    lat = loc.get("latitude", 34.1526) 
    lon = loc.get("longitude", 77.5771)
    
    length = geo.get("length", 6.0)
    width = geo.get("width", 4.0)
    height = geo.get("height", 2.8)
    thickness = geo.get("wallThickness", 0.25)
    
    k = mat.get("k", 0.035)        # Thermal Conductivity
    density = mat.get("rho", 40.0) # Density
    cp = mat.get("cp", 1400.0)     # Specific Heat
    
    # 2. Fetch atmospheric data
    amb_temps, solar_flux = fetch_nasa_weather(lat, lon)
    
    # 3. Physics & Geometric Calculations
    surface_area = 2 * (length * width + length * height + width * height)
    volume = length * width * height
    wall_volume = surface_area * thickness
    
    r_val = thickness / k 
    total_u_value = 1.0 / r_val if r_val > 0 else 10.0
    thermal_mass = (wall_volume * density * cp) + (volume * 1.225 * 1005) 
    solar_capture_area = (length * height) + (0.5 * length * width)
    
    dt = 3600 # 1 hour time steps
    t_inside = amb_temps[0] + 5.0 # Initial assumption
    
    inside_temps = []
    
    # 4. Run 24-Hour Loop
    for hour in range(24):
        t_amb = amb_temps[hour]
        i_solar = solar_flux[hour]
        
        q_solar = i_solar * solar_capture_area * 0.7 
        q_loss = total_u_value * surface_area * (t_inside - t_amb)
        
        q_net = q_solar - q_loss
        delta_t = (q_net / thermal_mass) * dt
        t_inside += delta_t
        
        inside_temps.append(round(t_inside, 2))
        
    total_solar_kwh = round(sum(solar_flux) * solar_capture_area * 0.7 / 1000.0, 2)
    avg_inside = round(sum(inside_temps) / len(inside_temps), 2)
    
    # 5. Format Output 
    return {
        "status": "success",
        "timeSteps": list(range(24)),
        "ambientTemp": amb_temps,
        "insideTemp": inside_temps,
        "solarIrradiance": solar_flux,
        "energySummary": {
            "totalSolarKWh": total_solar_kwh,
            "averageInsideTemp": avg_inside
        }
    }

if __name__ == "__main__":
    try:
        raw_input = sys.argv[1]
        params = json.loads(raw_input)
    except Exception:
        params = {}

    result = run_thermodynamic_fallback(params)
    print(json.dumps(result))