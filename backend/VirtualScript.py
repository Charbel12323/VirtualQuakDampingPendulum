"""
virtual_shake_table.py

Core simulation engine:
- Multi-story shear-building model
- Driven by real ground acceleration time series
- Computes floor displacements, accelerations, and damage metrics

You control building inputs from the UI:
- num_floors
- mass_per_floor
- story_height
- material_type
- base_isolated (yes/no)

This file is self-contained and ready to import.
"""

import numpy as np

# --- MATERIAL + SYSTEM PRESETS -----------------------------------------
# These are DEMO-LEVEL relative values (not code-checked design values).
# They just make concrete stiffer than steel, steel stiffer than wood, etc.

MATERIALS = {
    "Concrete": {
        "k_factor": 1.0,   # relative stiffness multiplier
        "xi": 0.03         # 3% damping (typical order)
    },
    "Steel": {
        "k_factor": 0.75,  # more flexible system
        "xi": 0.05         # 5% damping (with yielding/energy dissipation)
    },
    "Wood": {
        "k_factor": 0.4,   # lighter/more flexible
        "xi": 0.04
    }
}

# Base stiffness scale (you can tune this to make responses look nice)
BASE_K_STORY = 2.0e5  # N/m per story for a reference concrete frame (demo)


# --- BUILD M, C, K MATRICES --------------------------------------------

def build_mck(
    num_floors: int,
    material: str,
    mass_per_floor: float,
    story_height: float,
    base_isolated: bool = False,
):
    """
    Build mass (M), damping (C), and stiffness (K) matrices
    for an N-story shear-building model.

    Parameters
    ----------
    num_floors : int
    material : str              # "Concrete", "Steel", "Wood"
    mass_per_floor : float      # kg per floor (from UI/config)
    story_height : float        # m (used for drift; stored for clarity)
    base_isolated : bool

    Returns
    -------
    M, C, K : np.ndarray
    """

    if material not in MATERIALS:
        raise ValueError(f"Unknown material '{material}'. Choose from {list(MATERIALS.keys())}.")

    props = MATERIALS[material]
    k_factor = props["k_factor"]
    xi = props["xi"]

    # Story stiffness based on base value * material factor
    k_story = BASE_K_STORY * k_factor

    # Mass matrix
    M = np.diag([mass_per_floor] * num_floors)

    # Stiffness matrix K for simple shear building
    K = np.zeros((num_floors, num_floors))

    for i in range(num_floors):
        if i == 0:
            if num_floors == 1:
                K[i, i] = k_story
            else:
                K[i, i] = 2.0 * k_story
                K[i, i+1] = -k_story
        elif i == num_floors - 1:
            K[i, i] = k_story
            K[i, i-1] = -k_story
        else:
            K[i, i] = 2.0 * k_story
            K[i, i-1] = -k_story
            K[i, i+1] = -k_story

    # Proportional damping (very simplified)
    # Approximate a representative frequency and scale to match xi.
    m_ref = mass_per_floor
    wn = np.sqrt(k_story / m_ref)  # rad/s
    c_scalar = 2.0 * xi * wn * m_ref
    C = c_scalar * np.eye(num_floors)

    # Crude base isolation: soften first story stiffness
    if base_isolated:
        iso_factor = 0.2  # 20% of original stiffness at base
        K[0, 0] *= iso_factor

    return M, C, K


# --- NEWMARK-BETA INTEGRATION (MDOF) -----------------------------------

def newmark_mdoff(M, C, K, ag, dt):
    """
    Newmark-beta (average acceleration) for:
        M u¨ + C u˙ + K u = -M * 1 * ag(t)

    Parameters
    ----------
    M, C, K : np.ndarray
    ag      : np.ndarray, shape (n,)
              ground acceleration (m/s^2)
    dt      : float

    Returns
    -------
    u, v, a : np.ndarray
              displacement, velocity, acceleration (relative), shape (n, dof)
    """
    dof = M.shape[0]
    n = len(ag)

    u = np.zeros((n, dof))
    v = np.zeros((n, dof))
    a = np.zeros((n, dof))

    beta = 0.25
    gamma = 0.5

    # Initial acceleration assuming u0 = v0 = 0:
    # M a0 = -M * 1 * ag0  => a0 = -ag0
    a[0, :] = -ag[0] * np.ones(dof)

    # Precompute Newmark constants
    a0 = 1.0 / (beta * dt**2)
    a1 = gamma / (beta * dt)
    a2 = 1.0 / (beta * dt)
    a3 = 1.0 / (2.0 * beta) - 1.0
    a4 = gamma / beta - 1.0
    a5 = dt * (gamma / (2.0 * beta) - 1.0)

    # Effective stiffness
    K_eff = K + a0 * M + a1 * C
    K_eff_inv = np.linalg.inv(K_eff)

    ones = np.ones(dof)

    for i in range(1, n):
        p_eff = (
            -M @ (ones * ag[i])
            + M @ (a0 * u[i-1] + a2 * v[i-1] + a3 * a[i-1])
            + C @ (a1 * u[i-1] + a4 * v[i-1] + a5 * a[i-1])
        )

        u[i, :] = K_eff_inv @ p_eff

        a[i, :] = (
            a0 * (u[i, :] - u[i-1, :])
            - a2 * v[i-1, :]
            - a3 * a[i-1, :]
        )

        v[i, :] = (
            v[i-1, :]
            + dt * ((1.0 - gamma) * a[i-1, :] + gamma * a[i, :])
        )

    return u, v, a


# --- DAMAGE METRICS ----------------------------------------------------

def compute_damage_metrics(u, a, story_height: float):
    """
    Compute basic damage indicators from u(t), a(t).

    Parameters
    ----------
    u : np.ndarray, shape (n, dof)
    a : np.ndarray, shape (n, dof)
    story_height : float

    Returns
    -------
    dict with:
        max_drift       : float (max inter-story drift ratio)
        peak_floor_acc  : float (max |acceleration|, m/s^2)
        damage_index    : float in [0, 1]
    """
    _, dof = u.shape

    # Inter-story drift ratios over time
    drifts = []
    for i in range(1, dof):
        drift_ij = (u[:, i] - u[:, i-1]) / story_height
        drifts.append(np.abs(drift_ij).max())

    max_drift = max(drifts) if drifts else 0.0

    # Peak acceleration over all floors
    peak_floor_acc = float(np.abs(a).max())

    # Simple drift-based damage index (normalize by 2% drift)
    drift_limit = 0.02
    damage_index = float(min(1.0, max_drift / drift_limit))

    return {
        "max_drift": max_drift,
        "peak_floor_acc": peak_floor_acc,
        "damage_index": damage_index,
    }


# --- PUBLIC ENTRY POINT -----------------------------------------------

def run_simulation(
    ag,
    dt,
    num_floors: int = 5,
    material: str = "Steel",
    mass_per_floor: float = 3.0e4,
    story_height: float = 3.0,
    base_isolated: bool = False,
):
    """
    Run a single building-earthquake scenario.

    Parameters
    ----------
    ag : array-like
        ground acceleration time series (m/s^2)
    dt : float
        time step (s)
    num_floors : int
    material : str
        "Concrete", "Steel", "Wood"
    mass_per_floor : float
        kg per floor (UI input or default)
    story_height : float
        m (UI input or default)
    base_isolated : bool

    Returns
    -------
    dict:
        displacement : np.ndarray (n, dof)
        acceleration : np.ndarray (n, dof)
        metrics      : dict(max_drift, peak_floor_acc, damage_index)
    """
    ag = np.asarray(ag, dtype=float)

    M, C, K = build_mck(
        num_floors=num_floors,
        material=material,
        mass_per_floor=mass_per_floor,
        story_height=story_height,
        base_isolated=base_isolated,
    )

    u, v, a = newmark_mdoff(M, C, K, ag, dt)
    metrics = compute_damage_metrics(u, a, story_height)

    return {
        "displacement": u,
        "acceleration": a,
        "metrics": metrics,
    }


# --- QUICK LOCAL TEST --------------------------------------------------

if __name__ == "__main__":
    # Simple sanity test using a fake sine wave as "earthquake"
    duration = 10.0
    dt = 0.01
    t = np.arange(0.0, duration, dt)

    # Fake ground motion (peak ~0.3 g)
    ag = 0.3 * 9.81 * np.sin(2 * np.pi * 1.0 * t)

    res = run_simulation(
        ag=ag,
        dt=dt,
        num_floors=5,
        material="Steel",
        mass_per_floor=30000.0,
        story_height=3.0,
        base_isolated=False,
    )

    print("Max drift ratio    :", res["metrics"]["max_drift"])
    print("Peak floor accel g :", res["metrics"]["peak_floor_acc"] / 9.81)
    print("Damage index (0-1) :", res["metrics"]["damage_index"])
