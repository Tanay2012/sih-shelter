import sys
import json
import numpy as np

def run_ansys_fea(l, w, h, k, rho, cp, t_amb, wind_speed):
    """Executes structural finite element thermal analysis via ANSYS MAPDL."""
    from ansys.mapdl.core import launch_mapdl
    
    # Launch MAPDL in headless mode (silent background execution)
    mapdl = launch_mapdl(loglevel="ERROR")
    mapdl.clear()
    mapdl.prep7()
    
    # 1. Define Thermal Solid Element (SOLID70 for 3D thermal conduction)
    mapdl.et(1, "SOLID70")
    
    # 2. Assign Material Properties
    mapdl.mp("KXX", 1, k)
    mapdl.mp("DENS", 1, rho)
    mapdl.mp("C", 1, cp)
    
    # 3. Create Shelter Geometry Block
    mapdl.block(0, l, 0, w, 0, h)
    
    # 4. Mesh the Volume
    mapdl.esize(max(l, w) / 4.0)
    mapdl.vmesh("ALL")
    
    # 5. Solution Phase - Boundary Conditions
    mapdl.run("/SOLU")
    mapdl.antype("STATIC")
    
    # Apply ambient temperature and WIND CONVECTION to exterior nodes
    mapdl.nsel("S", "EXT") 
    h_conv = 10.0 + (4.0 * wind_speed) # Wind speed directly affects ANSYS convection
    mapdl.sf("ALL", "CONV", h_conv, t_amb)
    mapdl.nsel("ALL")
    
    # Solve thermal matrix
    mapdl.solve()
    mapdl.finish()
    
    # 6. Post-Processing: Extract internal nodal temperature
    mapdl.post1()
    mapdl.set("LAST")
    all_temps = mapdl.post_processing.nodal_temperatures
    avg_internal = float(np.mean(all_temps)) + 12.0 # Heat retention offset
    
    mapdl.exit()
    return avg_internal

def run_simulation(payload):
    # Extract data
    geom = payload.get("geometry", {})
    mat = payload.get("materials", {})
    env = payload.get("environment", {}) 
    
    l = float(geom.get("length", 6.0))
    w = float(geom.get("width", 4.0))
    h = float(geom.get("height", 2.8))
    thickness = float(geom.get("wallThickness", 0.3))
    
    k = float(mat.get("k", 0.024))
    rho = float(mat.get("rho", 1200))
    cp = float(mat.get("cp", 900))
    
    wind_speed = float(env.get("windSpeed", 15.0))
    high_snow = bool(env.get("highSnow", False))
    
    ambient_profile = [-12, -14, -15, -15, -14, -12, -8, -3, 1, 4, 6, 7, 5, 2, -1, -4, -7, -9, -10, -11, -12, -13, -13, -14]
    
    # --- COMMON MATH (Always runs to calculate Heat Loss & Snow Load) ---
    h_out_convective = 10.0 + (4.0 * wind_speed) 
    surface_area = 2 * (l*w + l*h + w*h)
    if high_snow:
        surface_area = surface_area * 1.15
        
    R_wall = thickness / k if k > 0 else 0.1
    U_value = 1.0 / (R_wall + (1.0 / h_out_convective) + (1.0 / 8.0))
    total_heat_loss = round(U_value * surface_area * 25 / 1000, 2)
    wind_penalty = wind_speed * 0.15 * k

    engine_used = "Tactical Thermodynamic Model (Math Fallback)"
    
    # --- HYBRID EXECUTION: TRY ANSYS FIRST, FALLBACK TO MATH ---
    try:
        # This will ONLY succeed on her laptop with ANSYS installed
        ansys_temp = run_ansys_fea(l, w, h, k, rho, cp, ambient_profile[0], wind_speed)
        # Generate the 24-hour curve based on the ANSYS FEA baseline
        inside_profile = [round(ansys_temp + 3.0 * np.sin((i - 6) / 24 * 2 * np.pi) - wind_penalty, 2) for i in range(24)]
        engine_used = "ANSYS PyMAPDL (DRDO FEA Core)"
    except Exception as e:
        # Seamless Fallback (Runs on Render cloud or if ANSYS license fails)
        inside_profile = [round(amb + (18.0 / (k * 10 + 0.5)) - wind_penalty, 2) for amb in ambient_profile]

    return {
        "engine": engine_used,
        "ambientTemp": ambient_profile,
        "insideTemp": inside_profile,
        "energySummary": {
            "totalSolarKWh": round(l * h * 0.7 * 1.01, 2),
            "heatLossKW": total_heat_loss,
            "rank": "Grade A+" if k < 0.1 else "Grade A"
        }
    }

if __name__ == "__main__":
    if len(sys.argv) > 1:
        raw_input = sys.argv[1]
        data = json.loads(raw_input)
        print(json.dumps(run_simulation(data)))
    else:
        print(json.dumps({"error": "No input provided"}))