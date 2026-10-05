# Builds shared/map.txt: the 48x48 Yard, four districts around a crossroads.
#   # border/concrete  C container  B building wall  T tower/pillar  F fence  K crates/sandbags
#   . asphalt  = road  , dirt  _ indoor floor  S spawn  L loot spot  l street lamp (floor)
import os, random
random.seed(7)
W = H = 48
g = [["." for _ in range(W)] for _ in range(H)]
def put(x, y, c):
    if 0 < x < W - 1 and 0 < y < H - 1:
        g[y][x] = c
def rect(x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            put(x, y, c)
def outline(x0, y0, x1, y1, c, doors=()):
    for x in range(x0, x1 + 1):
        put(x, y0, c); put(x, y1, c)
    for y in range(y0, y1 + 1):
        put(x0, y, c); put(x1, y, c)
    for (x, y) in doors:
        put(x, y, "_")

# border
for i in range(W):
    g[0][i] = g[H - 1][i] = "#"
    g[i][0] = g[i][W - 1] = "#"

# roads: a crossroads through the middle, plaza + water tower at the centre
rect(1, 22, 46, 25, "=")
rect(22, 1, 25, 46, "=")
rect(20, 20, 27, 27, ".")
rect(23, 23, 24, 24, "T")

# NW: container yard — rows of containers with lanes, a few stacks
for y in (4, 8, 12, 16):
    x = 3
    while x < 19:
        n = random.choice([3, 4, 5])
        if x + n > 20:
            break
        rect(x, y, x + n - 1, y, "C")
        if random.random() < 0.35:
            rect(x, y + 1, x + 1, y + 1, "C")
        x += n + random.choice([2, 2, 3])
rect(3, 19, 4, 19, "K"); rect(15, 2, 15, 3, "K")

# NE: warehouse with doorways, pillars and shelving
outline(29, 4, 43, 17, "B", doors=[(36, 4), (37, 4), (36, 17), (37, 17), (29, 10), (29, 11), (43, 10), (43, 11)])
rect(30, 5, 42, 16, "_")
for x in (32, 36, 40):
    for y in (7, 14):
        put(x, y, "T")
for x0 in (31, 38):
    rect(x0, 9, x0 + 3, 9, "K")
    rect(x0, 12, x0 + 3, 12, "K")
rect(30, 2, 31, 2, "K"); rect(42, 19, 43, 19, "K")

# SW: office block, four small buildings with doors and windows, alleys between
for (x0, y0) in ((3, 29), (12, 29), (3, 38), (12, 38)):
    outline(x0, y0, x0 + 6, y0 + 6, "B", doors=[(x0 + 3, y0), (x0 + 3, y0 + 6), (x0, y0 + 3), (x0 + 6, y0 + 4)])
    rect(x0 + 1, y0 + 1, x0 + 5, y0 + 5, "_")
    put(x0 + 2, y0 + 2, "K")
rect(19, 33, 19, 35, "K"); rect(9, 46 - 1, 10, 46 - 1, "K")

# SE: open field with sparse cover, and a fenced compound around a watchtower
rect(26, 26, 46, 46, ",")
for (x, y) in ((29, 29), (30, 29), (27, 35), (31, 41), (32, 41), (40, 28), (45, 31), (44, 44), (28, 44)):
    put(x, y, "K")
outline(34, 34, 43, 43, "F", doors=[(34, 38), (34, 39), (43, 38), (38, 34), (39, 34), (38, 43)])
rect(35, 35, 42, 42, ",")
rect(38, 38, 39, 39, "T")
put(36, 41, "K"); put(41, 36, "K")

# street lamps along the roads (lit zones: you're seen from far away under one)
for (x, y) in ((6, 22), (14, 25), (33, 22), (41, 25), (22, 6), (25, 14), (22, 33), (25, 41), (21, 21), (26, 26), (38, 37)):
    g[y][x] = "l"

# spawns: two per district, far apart
for (x, y) in ((2, 2), (19, 10), (45, 2), (34, 20), (2, 45), (20, 44), (45, 45), (45, 29)):
    g[y][x] = "S"
# loot: inside buildings, between containers, in the field and compound
for (x, y) in ((5, 6), (12, 10), (17, 14), (9, 18), (33, 6), (40, 8), (35, 13), (41, 15),
               (4, 33), (15, 32), (6, 41), (14, 41), (30, 33), (36, 36), (41, 41), (44, 38),
               (11, 24), (36, 23), (23, 12), (24, 36)):
    assert g[y][x] in "._,=", (x, y, g[y][x])
    g[y][x] = "L"

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
open(f"{root}/shared/map.txt", "w").write("\n".join("".join(r) for r in g) + "\n")
print("\n".join("".join(r) for r in g))
