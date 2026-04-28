"""
model.py  –  Train & Save Crop Yield Decision Tree
====================================================
Run once before starting the server:
    python model.py

What it does:
  1. Loads data.csv
  2. Cleans data (drop nulls / duplicates)
  3. Encodes SoilType with LabelEncoder
  4. Splits into 80/20 train-test
  5. Trains DecisionTreeRegressor (max_depth=6)
  6. Prints MAE and R² scores
  7. Saves model + encoder → model.pkl
"""

import pandas as pd
import numpy as np
from sklearn.tree import DecisionTreeRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.preprocessing import LabelEncoder
import pickle, os, sys

print("=" * 55)
print("  AgriPredict — Model Training")
print("=" * 55)

# ── 1. Load ──────────────────────────────────────────────────
csv_path = os.path.join(os.path.dirname(__file__), "data.csv")
if not os.path.exists(csv_path):
    print(f"ERROR: data.csv not found at {csv_path}")
    sys.exit(1)

df = pd.read_csv(csv_path)
print(f"\n📂  Loaded {len(df)} rows from data.csv")
print(df.head(4).to_string(index=False))

# ── 2. Clean ─────────────────────────────────────────────────
before = len(df)
df.dropna(inplace=True)
df.drop_duplicates(inplace=True)
print(f"\n🧹  Cleaned: {before} → {len(df)} rows")

# ── 3. Encode SoilType ───────────────────────────────────────
le = LabelEncoder()
df["SoilEnc"] = le.fit_transform(df["SoilType"])
print(f"🔡  Soil classes: {list(le.classes_)}")

# ── 4. Features / Target ─────────────────────────────────────
FEATURES = ["Temperature", "Rainfall", "Humidity", "SoilEnc"]
X = df[FEATURES].values
y = df["Yield"].values

# ── 5. Train-Test Split ──────────────────────────────────────
X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42)
print(f"\n✂️   Train: {len(X_tr)} | Test: {len(X_te)}")

# ── 6. Train ─────────────────────────────────────────────────
model = DecisionTreeRegressor(max_depth=6, min_samples_split=3, random_state=42)
model.fit(X_tr, y_tr)
print("🌳  DecisionTreeRegressor trained")

# ── 7. Evaluate ───────────────────────────────────────────────
preds = model.predict(X_te)
mae  = mean_absolute_error(y_te, preds)
r2   = r2_score(y_te, preds)
print(f"\n📊  Evaluation")
print(f"    MAE : {mae:.4f}  (lower is better)")
print(f"    R²  : {r2:.4f}  (1.0 = perfect)")

# ── 8. Save ──────────────────────────────────────────────────
pkl_path = os.path.join(os.path.dirname(__file__), "model.pkl")
with open(pkl_path, "wb") as f:
    pickle.dump({"model": model, "encoder": le, "features": FEATURES}, f)

print(f"\n✅  model.pkl saved → {pkl_path}")
print("=" * 55)
print("  Run:  node server.js")
print("=" * 55)
