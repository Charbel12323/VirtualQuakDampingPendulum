# Virtual Shake Table - Parameter Guide

## 🚨 Why Are Drift Ratios So High?

**RESONANCE!** When the earthquake frequency matches your building's natural frequency, you get massive amplification (like pushing a swing at the right time).

### The Math Behind It:
- **Building Natural Frequency** = √(stiffness/mass) / (2π) Hz
- When **Earthquake Frequency ≈ Building Frequency** → **10x-100x amplification!**
- This is why high drift ratios occur

---

## 📊 Parameters Explained

### **1. Number of Floors**
- **What it does**: More floors = taller building
- **Effect on response**: 
  - More floors = lower natural frequency
  - Taller buildings are more flexible → more drift
  - More floors = different mode shapes

### **2. Material Type**
Affects stiffness and damping:

| Material | Stiffness Factor | Damping | Behavior |
|----------|-----------------|---------|----------|
| **Concrete** | 1.0 (stiffest) | 3% | Resists deformation best, less drift |
| **Steel** | 0.75 (medium) | 5% | More flexible, higher damping |
| **Wood** | 0.4 (flexible) | 4% | Most flexible, largest drifts |

### **3. Base Isolation** ✅
- **What it does**: Adds flexible layer at base of building
- **Effect**: Reduces stiffness of first story to 20% of normal
- **Result**: Building moves more as a unit, less story drift, less damage
- **Real-world example**: Rubber bearings under building

### **4. Mass Per Floor** (kg)
- Default: 30,000 kg per floor
- **Effect**:
  - Higher mass → lower natural frequency
  - More inertia → larger forces but lower accelerations
  - Affects how building responds to shaking

### **5. Story Height** (meters)
- Default: 3.0m per story
- **Effect**: 
  - Only affects drift ratio calculation
  - Drift ratio = (displacement difference) / story height
  - Taller stories = smaller drift ratio for same displacement

---

## 🌊 Earthquake Parameters

### **6. PGA (Peak Ground Acceleration)** - in g's
**This controls earthquake strength!**
- **0.1g** = Minor shaking, light damage possible
- **0.3g** = Moderate earthquake (DEFAULT)
- **0.5g** = Strong earthquake, significant damage likely
- **0.8g+** = Severe/violent shaking, collapse possible

### **7. Duration** (seconds)
**How long the shaking lasts**
- Typical: 10-30 seconds
- Longer duration = more damage accumulation
- More cycles = more fatigue and damage

### **8. Frequency (Hz)** ⚠️ **MOST IMPORTANT FOR RESONANCE**
**The dominant frequency of the earthquake**

**Typical earthquake frequencies: 0.5 - 3.0 Hz**

**How it affects response:**
- If `freqHz` ≈ building's natural frequency → **RESONANCE** → **HUGE DRIFT**
- If frequencies don't match → normal response

**Example:**
- 5-story steel building: natural frequency ≈ 0.8 Hz
- If earthquake = 0.8 Hz → **DISASTER** (10x-100x amplification)
- If earthquake = 2.5 Hz → manageable response

### **9. Motion Type**
- **Sine**: Pure sinusoidal wave (unrealistic but shows resonance clearly)
- **Pulse**: Decaying wave packet (more realistic earthquake)

---

## 🔧 How to Control Drift

### To **REDUCE** High Drift:
1. **Change frequency away from resonance**
   - If you have high drift, try freqHz = 0.5, 2.0, or 3.0 Hz
   - Avoid the building's natural frequency

2. **Lower earthquake strength**
   - Reduce PGA from 0.3g to 0.1g or 0.2g

3. **Stiffer building**
   - Use Concrete instead of Wood
   - This raises natural frequency

4. **Enable base isolation**
   - Reduces transmitted motion
   - Isolates building from ground

5. **Increase damping** (would need code change)
   - More energy dissipation
   - Currently: Concrete=3%, Steel=5%, Wood=4%

### To **INCREASE** Drift (test worst case):
1. **Hit resonance**
   - Match earthquake frequency to building frequency
   - The simulation now shows the building's natural frequency!

2. **Stronger earthquake**
   - Increase PGA to 0.5g or higher

3. **More flexible building**
   - Use Wood material
   - More floors

---

## 📐 Understanding the Math

### Drift Ratio Formula:
```
Drift Ratio = (Displacement_floor_i - Displacement_floor_i-1) / Story_Height
```

### Damage Index:
```
Damage Index = min(1.0, Max_Drift / 0.02)

Where:
- 0.02 = 2% drift limit (typical building code collapse threshold)
- 0.0-0.3 = Low damage (green)
- 0.3-0.7 = Moderate damage (yellow/amber)
- 0.7-1.0 = Severe damage/collapse (red)
```

### Natural Frequency Calculation:
```
ω_n = √(k/m)           [rad/s]
f_n = ω_n / (2π)       [Hz]

Where:
- k = lateral stiffness (BASE_K_STORY × material kFactor)
- m = mass per floor
```

---

## 🎯 Recommended Test Cases

### **Test 1: Normal Earthquake (Off-Resonance)**
- PGA: 0.3g
- Frequency: 2.5 Hz
- Material: Steel
- Floors: 5
- **Expected**: Moderate drift (< 1%)

### **Test 2: Resonance Disaster**
- PGA: 0.3g
- Frequency: 0.8 Hz (match building frequency!)
- Material: Steel
- Floors: 5
- **Expected**: HUGE drift (> 5%)

### **Test 3: Base Isolation Effectiveness**
- Run Test 2 WITHOUT base isolation
- Run Test 2 WITH base isolation
- **Compare**: Should see 50-80% drift reduction

### **Test 4: Material Comparison**
- Same earthquake, different materials
- See how Concrete vs Steel vs Wood behave

---

## 🔬 The Physics

This simulation uses:
- **Newmark-Beta Integration**: Numerical method for dynamic analysis
- **Shear Building Model**: Each floor only moves horizontally
- **Modal Damping**: Energy dissipation proportional to velocity
- **Multi-DOF System**: Each floor is a degree of freedom

The equation being solved:
```
M·ü + C·u̇ + K·u = -M·1·a_g(t)

Where:
- M = mass matrix
- C = damping matrix
- K = stiffness matrix
- u = displacement vector
- a_g(t) = ground acceleration
```

---

## 💡 Pro Tips

1. **Always check the natural frequency** - The simulation now returns this!
2. **Resonance is real** - Many real building collapses happen due to resonance
3. **Base isolation works** - It's used in hospitals and important buildings
4. **Frequency matters more than PGA** - A 0.2g resonant quake can be worse than a 0.5g off-resonant one
5. **Duration matters** - Longer shaking = more damage even at same PGA

---

## 🐛 If You Still See Issues

The math is correct! High drift means:
1. You're hitting resonance (check frequency ratio)
2. The earthquake is too strong (reduce PGA)
3. The building is too flexible (use Concrete, fewer floors)

This is realistic structural engineering behavior!
