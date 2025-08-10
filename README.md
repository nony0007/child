# Family Rescue: 99 Nights

A tiny browser game you can upload to GitHub Pages and play together on one keyboard (supports two players).
No build steps, no external libraries — just open `index.html`.

## Premise
Start in a random spooky forest. Complete **3 mini‑games** at shrines to earn sigils, craft a **shovel**,
dig to uncover the **underground chamber** and unlock the **lost child**. Then **build a house** and live
happily ever after. But beware: **don’t go outside at night** — creatures roam. If they touch you, it’s
**GAME OVER**. You have **99 nights** to rescue the child.

## Controls
- **Player 1**: Move = WASD, Interact = `E`, Dig = `F`, Craft panel = `C`
- **Player 2**: Move = Arrow Keys, Interact = Right Shift, Dig = Right Ctrl
- **Pause** = `P`
- Right‑click to switch camera between Player 1 and Player 2.

## Crafting
- **Shovel** = wood 3 + stone 2
- **House Frame** = wood 20 + stone 10

## How to Play on GitHub Pages
1. Upload all files in this folder to a public repo (e.g., `FamilyRescueGame`).
2. In the repo Settings → Pages, set Source to **`main`** and Folder to **`/root`** (or the default).
3. Open your GitHub Pages URL (e.g., `https://<username>.github.io/FamilyRescueGame/`).

## Notes
- The day/night cycle switches every **2 minutes**.
- The world is tile‑based and randomly generated each run.
- Mini‑games included: Simon, Quick Click, and a tiny riddle.
- The child can only be freed if you have all **3 sigils**.
- To win, rescue the child, craft the house frame, place it on a clear tile, and enjoy **THE END**.
- If you reach the **100th night** without rescuing the child: **GAME OVER**.

Have fun!
