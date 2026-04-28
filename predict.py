"""
predict.py  –  Run a single crop-yield prediction
==================================================
Called by server.js via child_process:
    python predict.py <temperature> <rainfall> <humidity> <soiltype>

Prints a JSON object and exits:
    {"yield": 4.75}          on success
    {"error": "..."}         on failure
"""

import sys, os, json, pickle
import numpy as np

def load_bundle():
    pkl = os.path.join(os.path.dirname(__file__), "model.pkl")
    if not os.path.exists(pkl):
        raise FileNotFoundError(
            "model.pkl not found. Run 'python model.py' first."
        )
    with open(pkl, "rb") as f:
        return pickle.load(f)

def predict(temperature, rainfall, humidity, soil_type):
    bundle  = load_bundle()
    model   = bundle["model"]
    encoder = bundle["encoder"]

    # Encode soil (fall back to first class if unknown)
    classes = list(encoder.classes_)
    if soil_type not in classes:
        soil_type = classes[0]
    soil_enc = int(encoder.transform([soil_type])[0])

    X = np.array([[float(temperature), float(rainfall),
                   float(humidity),    float(soil_enc)]])

    result = float(model.predict(X)[0])
    return round(result, 2)

if __name__ == "__main__":
    if len(sys.argv) != 5:
        print(json.dumps({"error":
            "Usage: predict.py <temp> <rainfall> <humidity> <soiltype>"}))
        sys.exit(1)

    try:
        y = predict(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4])
        print(json.dumps({"yield": y}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
