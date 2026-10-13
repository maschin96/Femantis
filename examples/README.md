# Beispielnetze

`cantilever.msh`: diskreter Kragträger 120 × 30 × 18 mm, 288 Tet4-Zellen, getrennte Volumengruppen und Randgruppen. Erzeugt durch `scripts/generate_example.py`. Reine Viewer-Geometrie, kein berechneter Lastfall.

`tet10-groups.msh`: ein geradkantiges Tet10 mit überlappenden Gruppen. Unverändertes Fixture aus `maschin96/FEM-Toolbox/tests/fixtures/quadratic_groups.msh`, Commit `baae07f088a87ce6e256af3c5855a3b110d0f17a`, MIT-Lizenz (siehe `TOOLBOX-LICENSE.txt`). Koordinaten in m; keine Ergebnisdaten.

`heat.toml`, `elasticity.toml`, `electrostatics.toml`: stationäre Model-Schema-1-Fälle für `cantilever.msh`. Wärme: 300/350 K mit k=2 W/(m K). Elastizität: E=100 GPa, ν=0, axialer Zug mit 1 MPa Flächenlast. Elektrostatik: 0/10 V, relative Permittivität 1. Die Querseiten sind jeweils ohne zusätzliche Flächenlasten/Flüsse. Die analytischen Referenzen und Toleranzen stehen in `tests/backend/test_models.py`. Alle drei Dateien wurden mit der öffentlichen `Model.from_file`-API eingelesen.
