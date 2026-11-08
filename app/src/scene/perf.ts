// Rendering shortcuts that are safe everywhere.
import * as THREE from "three";

// three.js walks the whole scene every frame to update world matrices, even under hidden
// objects. A night has eight soldiers (hundreds of bones each) and pooled effects that are hidden
// most of the time, so skip hidden subtrees: they aren't drawn, and they're brought up to date
// the frame they show again (the skipped node is marked stale, which forces its children too).
// Code that needs a hidden object's position calls getWorldPosition / updateWorldMatrix, which
// don't go through here.
const update = THREE.Object3D.prototype.updateMatrixWorld;
if (!(update as any).__skipsHidden) {
  const patched = function (this: THREE.Object3D, force?: boolean) {
    if (!this.visible && this.parent !== null) {
      this.matrixWorldNeedsUpdate = true;
      return;
    }
    update.call(this, force);
  };
  (patched as any).__skipsHidden = true;
  THREE.Object3D.prototype.updateMatrixWorld = patched;
}
