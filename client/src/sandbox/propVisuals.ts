import * as THREE from 'three';
import type { PropKind } from '@ragelab/shared';

/**
 * Stylized low-poly meshes for sandbox props. Geometries and materials are
 * shared; each spawn gets its own Group so we can toggle lights/screens.
 */
const geo = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12, 1),
  cone: new THREE.ConeGeometry(1, 1, 12, 1),
  sphere: new THREE.SphereGeometry(1, 12, 8),
  torus: new THREE.TorusGeometry(1, 0.38, 8, 14),
  plane: new THREE.PlaneGeometry(1, 1),
};

const mats = new Map<string, THREE.MeshStandardMaterial>();

function mat(key: string, color: number, extras: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.62,
      metalness: 0.08,
      envMapIntensity: 0.45,
      ...extras,
    });
    mats.set(key, m);
  }
  return m;
}

function add(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  rx = 0,
  ry = 0,
  rz = 0,
  role?: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (role) mesh.userData.role = role;
  parent.add(mesh);
  return mesh;
}

function group(kind: PropKind): THREE.Group {
  const root = new THREE.Group();
  root.name = `propVisual:${kind}`;
  return root;
}

export function createPropVisual(kind: PropKind): THREE.Group {
  switch (kind) {
    case 'crate':
      return crate();
    case 'barrel':
      return barrel(0x37515f, 0xb8c0c6);
    case 'explosive_barrel':
      return barrel(0xb32d1c, 0xf0c14a);
    case 'ball':
      return sphereProp(0xe8e34a);
    case 'plank':
      return plank();
    case 'canister':
      return canister();
    case 'chair':
      return chair();
    case 'cardboard_box':
      return cardboard();
    case 'trash_bin':
      return trashBin();
    case 'shopping_cart':
      return cart();
    case 'sofa':
      return sofa();
    case 'bucket':
      return bucket();
    case 'traffic_cone':
      return cone();
    case 'road_sign':
      return sign();
    case 'bricks':
      return bricks();
    case 'ladder':
      return ladder();
    case 'pallet':
      return pallet();
    case 'pizza_box':
      return pizza();
    case 'frying_pan':
      return pan();
    case 'kettle':
      return kettle();
    case 'traffic_barrel':
      return barrel(0xe25b14, 0xffffff);
    case 'stuffed_toy':
      return stuffed();
    case 'duck':
      return duck();
    case 'chicken':
      return chicken();
    case 'watermelon':
      return melon();
    case 'soda_cup':
      return soda();
    case 'toilet_paper':
      return tp();
    case 'toothbrush':
      return toothbrush();
    case 'giant_dice':
      return dice();
    case 'balloons':
      return balloons();
    case 'banana_peel':
      return banana();
    case 'whoopee':
      return whoopee();
    case 'donut':
      return donut();
    case 'wheel':
      return wheel();
    case 'beach_ball':
      return beachBall();
    case 'bowling_ball':
      return sphereProp(0x1a1c28, 0.28);
    case 'bowling_pin':
      return pin();
    case 'magnet':
      return magnet();
    case 'mattress':
      return mattress();
    case 'hockey_puck':
      return puck();
    case 'giant_spring':
      return spring();
    case 'tv':
      return tv();
    case 'radio':
      return radio();
    case 'computer':
      return computer();
    case 'loose_door':
      return door();
    case 'extinguisher':
      return extinguisher();
    case 'broom':
      return broom();
    case 'scooter':
      return scooter();
    case 'desk_lamp':
      return lamp();
    default:
      return crate();
  }
}

function crate(): THREE.Group {
  const g = group('crate');
  const wood = mat('crate', 0xa9793f, { roughness: 0.86 });
  const band = mat('crateBand', 0x6a4a28, { roughness: 0.7 });
  add(g, geo.box, wood, 0, 0, 0, 0.8, 0.8, 0.8);
  add(g, geo.box, band, 0, 0.38, 0, 0.82, 0.05, 0.82);
  add(g, geo.box, band, 0, -0.38, 0, 0.82, 0.05, 0.82);
  return g;
}

function barrel(body: number, stripe: number): THREE.Group {
  const g = group('barrel');
  add(g, geo.cyl, mat(`bar${body}`, body, { metalness: 0.72, roughness: 0.42 }), 0, 0, 0, 0.32, 0.94, 0.32);
  add(g, geo.cyl, mat(`barS${stripe}`, stripe, { metalness: 0.2, roughness: 0.5 }), 0, 0.08, 0, 0.325, 0.12, 0.325);
  return g;
}

function sphereProp(color: number, r = 0.35): THREE.Group {
  const g = group('ball');
  add(g, geo.sphere, mat(`sph${color}`, color, { roughness: 0.45 }), 0, 0, 0, r, r, r);
  return g;
}

function plank(): THREE.Group {
  const g = group('plank');
  add(g, geo.box, mat('plank', 0x8f6a3c, { roughness: 0.9 }), 0, 0, 0, 2.2, 0.12, 0.44);
  return g;
}

function canister(): THREE.Group {
  const g = group('canister');
  const m = mat('can', 0xd9a021, { metalness: 0.7, roughness: 0.38 });
  add(g, geo.box, m, 0, -0.02, 0, 0.32, 0.42, 0.24);
  add(g, geo.cyl, mat('canCap', 0x3a3a3a, { metalness: 0.6 }), 0, 0.24, 0, 0.05, 0.08, 0.05);
  return g;
}

function chair(): THREE.Group {
  const g = group('chair');
  const frame = mat('chairF', 0x3a3e46, { metalness: 0.45, roughness: 0.4 });
  const seat = mat('chairS', 0x1c1e22, { roughness: 0.7 });
  add(g, geo.box, seat, 0, 0.02, 0, 0.44, 0.06, 0.44);
  add(g, geo.box, seat, 0, 0.28, -0.18, 0.44, 0.46, 0.06);
  add(g, geo.cyl, frame, 0, -0.22, 0, 0.04, 0.4, 0.04);
  add(g, geo.cyl, frame, 0, -0.4, 0, 0.18, 0.04, 0.18);
  return g;
}

function cardboard(): THREE.Group {
  const g = group('cardboard_box');
  const c = mat('card', 0xc9a36a, { roughness: 0.92 });
  add(g, geo.box, c, 0, 0, 0, 0.76, 0.64, 0.76);
  add(g, geo.box, mat('cardTape', 0xd8c48a), 0, 0.33, 0, 0.78, 0.02, 0.12);
  return g;
}

function trashBin(): THREE.Group {
  const g = group('trash_bin');
  add(g, geo.cyl, mat('bin', 0x3d4a3a, { metalness: 0.35 }), 0, -0.04, 0, 0.28, 0.76, 0.28);
  add(g, geo.cyl, mat('binLid', 0x2a3228, { metalness: 0.4 }), 0, 0.38, 0, 0.3, 0.06, 0.3);
  return g;
}

function cart(): THREE.Group {
  const g = group('shopping_cart');
  const chrome = mat('cart', 0xb8c0c8, { metalness: 0.88, roughness: 0.28 });
  add(g, geo.box, chrome, 0, 0.08, 0, 0.7, 0.04, 0.48);
  add(g, geo.box, chrome, 0, 0.28, 0, 0.68, 0.36, 0.04);
  add(g, geo.box, chrome, 0.34, 0.22, 0, 0.04, 0.44, 0.48);
  add(g, geo.box, chrome, -0.34, 0.22, 0, 0.04, 0.44, 0.48);
  const tire = mat('cartTire', 0x222226);
  add(g, geo.cyl, tire, 0.26, -0.32, 0.18, 0.07, 0.05, 0.07, 0, 0, Math.PI / 2);
  add(g, geo.cyl, tire, -0.26, -0.32, 0.18, 0.07, 0.05, 0.07, 0, 0, Math.PI / 2);
  add(g, geo.cyl, tire, 0.26, -0.32, -0.18, 0.07, 0.05, 0.07, 0, 0, Math.PI / 2);
  add(g, geo.cyl, tire, -0.26, -0.32, -0.18, 0.07, 0.05, 0.07, 0, 0, Math.PI / 2);
  return g;
}

function sofa(): THREE.Group {
  const g = group('sofa');
  const cloth = mat('sofa', 0x5a6b4a, { roughness: 0.85 });
  add(g, geo.box, cloth, 0, -0.12, 0, 1.86, 0.32, 0.78);
  add(g, geo.box, cloth, 0, 0.22, -0.28, 1.86, 0.5, 0.22);
  add(g, geo.box, cloth, 0.86, 0.08, 0.08, 0.14, 0.42, 0.7);
  add(g, geo.box, cloth, -0.86, 0.08, 0.08, 0.14, 0.42, 0.7);
  return g;
}

function bucket(): THREE.Group {
  const g = group('bucket');
  add(g, geo.cyl, mat('bucket', 0xc45a28, { metalness: 0.45 }), 0, 0, 0, 0.18, 0.4, 0.18);
  add(g, geo.torus, mat('bucketH', 0x888888, { metalness: 0.7 }), 0, 0.18, 0, 0.16, 0.16, 0.16, Math.PI / 2, 0, 0);
  return g;
}

function cone(): THREE.Group {
  const g = group('traffic_cone');
  add(g, geo.box, mat('coneBase', 0x2a2a2a), 0, -0.28, 0, 0.36, 0.05, 0.36);
  add(g, geo.cone, mat('cone', 0xe85d12, { roughness: 0.5 }), 0, 0.02, 0, 0.16, 0.58, 0.16);
  add(g, geo.cyl, mat('coneStripe', 0xf4f4f4), 0, -0.02, 0, 0.12, 0.06, 0.12);
  return g;
}

function sign(): THREE.Group {
  const g = group('road_sign');
  add(g, geo.cyl, mat('signPole', 0x9aa0a6, { metalness: 0.7 }), 0, -0.15, 0, 0.03, 1.2, 0.03);
  add(g, geo.box, mat('signFace', 0xe8b423), 0, 0.42, 0.02, 0.52, 0.52, 0.04);
  return g;
}

function bricks(): THREE.Group {
  const g = group('bricks');
  const b = mat('brick', 0xa24a32, { roughness: 0.88 });
  add(g, geo.box, b, -0.12, -0.08, 0, 0.3, 0.12, 0.16);
  add(g, geo.box, b, 0.14, -0.08, 0.02, 0.3, 0.12, 0.16);
  add(g, geo.box, b, 0, 0.06, -0.02, 0.32, 0.12, 0.16);
  add(g, geo.box, b, -0.08, 0.18, 0.04, 0.28, 0.12, 0.16);
  return g;
}

function ladder(): THREE.Group {
  const g = group('ladder');
  const w = mat('lad', 0xb48a3c, { roughness: 0.8 });
  add(g, geo.box, w, -0.16, 0, 0, 0.05, 2.1, 0.05);
  add(g, geo.box, w, 0.16, 0, 0, 0.05, 2.1, 0.05);
  for (let i = -4; i <= 4; i++) add(g, geo.box, w, 0, i * 0.2, 0, 0.32, 0.04, 0.04);
  return g;
}

function pallet(): THREE.Group {
  const g = group('pallet');
  const w = mat('pal', 0x8a6a3c, { roughness: 0.88 });
  add(g, geo.box, w, 0, -0.04, 0, 1.4, 0.06, 1.1);
  add(g, geo.box, w, -0.5, 0.04, 0, 0.12, 0.1, 1.1);
  add(g, geo.box, w, 0, 0.04, 0, 0.12, 0.1, 1.1);
  add(g, geo.box, w, 0.5, 0.04, 0, 0.12, 0.1, 1.1);
  return g;
}

function pizza(): THREE.Group {
  const g = group('pizza_box');
  add(g, geo.box, mat('pizza', 0xd8c38a, { roughness: 0.86 }), 0, 0, 0, 0.84, 0.1, 0.84);
  add(g, geo.cyl, mat('pizzaTop', 0xd45a2a), 0, 0.06, 0, 0.28, 0.02, 0.28);
  return g;
}

function pan(): THREE.Group {
  const g = group('frying_pan');
  add(g, geo.cyl, mat('pan', 0x2a2d32, { metalness: 0.82, roughness: 0.32 }), 0, 0, 0, 0.22, 0.05, 0.22);
  add(g, geo.cyl, mat('panH', 0x222428, { metalness: 0.5 }), 0.32, 0, 0, 0.03, 0.28, 0.03, 0, 0, Math.PI / 2);
  return g;
}

function kettle(): THREE.Group {
  const g = group('kettle');
  add(g, geo.sphere, mat('ket', 0xc0c6ce, { metalness: 0.8, roughness: 0.28 }), 0, 0, 0, 0.14, 0.14, 0.14);
  add(g, geo.cyl, mat('ketSpout', 0xa8aeb4, { metalness: 0.8 }), 0.12, 0.04, 0, 0.03, 0.12, 0.03, 0, 0, Math.PI / 2);
  return g;
}

function stuffed(): THREE.Group {
  const g = group('stuffed_toy');
  const fur = mat('teddy', 0xe07a9a, { roughness: 0.9 });
  add(g, geo.sphere, fur, 0, -0.04, 0, 0.18, 0.2, 0.16);
  add(g, geo.sphere, fur, 0, 0.18, 0.02, 0.12, 0.12, 0.12);
  add(g, geo.sphere, fur, -0.1, 0.26, 0, 0.05, 0.05, 0.04);
  add(g, geo.sphere, fur, 0.1, 0.26, 0, 0.05, 0.05, 0.04);
  return g;
}

function duck(): THREE.Group {
  const g = group('duck');
  const y = mat('duck', 0xf0d23a, { roughness: 0.45 });
  add(g, geo.sphere, y, 0, 0, 0, 0.16, 0.12, 0.18);
  add(g, geo.sphere, y, 0, 0.1, 0.12, 0.08, 0.08, 0.08);
  add(g, geo.cone, mat('beak', 0xe07a20), 0, 0.08, 0.2, 0.04, 0.08, 0.04, Math.PI / 2, 0, 0);
  return g;
}

function chicken(): THREE.Group {
  const g = group('chicken');
  const w = mat('chick', 0xf2efe4, { roughness: 0.7 });
  add(g, geo.sphere, w, 0, 0, 0, 0.14, 0.14, 0.16);
  add(g, geo.sphere, w, 0, 0.12, 0.1, 0.08, 0.08, 0.08);
  add(g, geo.cone, mat('comb', 0xd22b2b), 0, 0.22, 0.1, 0.04, 0.08, 0.04);
  add(g, geo.cone, mat('beak2', 0xe8a020), 0, 0.1, 0.18, 0.03, 0.06, 0.03, Math.PI / 2, 0, 0);
  return g;
}

function melon(): THREE.Group {
  const g = group('watermelon');
  add(g, geo.sphere, mat('melon', 0x3d8a42, { roughness: 0.7 }), 0, 0, 0, 0.22, 0.18, 0.22);
  add(g, geo.sphere, mat('melonStripe', 0x2a5e30), 0, 0, 0, 0.225, 0.06, 0.225);
  return g;
}

function soda(): THREE.Group {
  const g = group('soda_cup');
  add(g, geo.cyl, mat('cup', 0xe8e8ea, { roughness: 0.35 }), 0, -0.02, 0, 0.12, 0.4, 0.14);
  add(g, geo.cyl, mat('lid', 0xffffff), 0, 0.2, 0, 0.13, 0.04, 0.13);
  add(g, geo.cyl, mat('straw', 0xff4d6a), 0.04, 0.32, 0, 0.012, 0.22, 0.012);
  return g;
}

function tp(): THREE.Group {
  const g = group('toilet_paper');
  add(g, geo.cyl, mat('tp', 0xf4f1ea, { roughness: 0.8 }), 0, 0, 0, 0.1, 0.2, 0.1, 0, 0, Math.PI / 2);
  add(g, geo.cyl, mat('tpCore', 0xd8c8a0), 0, 0, 0, 0.03, 0.22, 0.03, 0, 0, Math.PI / 2);
  return g;
}

function toothbrush(): THREE.Group {
  const g = group('toothbrush');
  add(g, geo.box, mat('brushH', 0x4ec4e0), 0, 0, -0.08, 0.05, 0.05, 0.85);
  add(g, geo.box, mat('bristles', 0xf4f4f8), 0, 0.04, 0.32, 0.06, 0.05, 0.16);
  return g;
}

function dice(): THREE.Group {
  const g = group('giant_dice');
  add(g, geo.box, mat('dice', 0xf5f0e6, { roughness: 0.55 }), 0, 0, 0, 0.56, 0.56, 0.56);
  const pip = mat('pip', 0x1a1a1a);
  add(g, geo.sphere, pip, 0, 0.29, 0, 0.05, 0.05, 0.05);
  add(g, geo.sphere, pip, 0.14, 0, 0.29, 0.05, 0.05, 0.05);
  add(g, geo.sphere, pip, -0.14, 0, 0.29, 0.05, 0.05, 0.05);
  return g;
}

function balloons(): THREE.Group {
  const g = group('balloons');
  add(g, geo.sphere, mat('balR', 0xff5a7a, { roughness: 0.35 }), -0.12, 0.12, 0, 0.16, 0.2, 0.16);
  add(g, geo.sphere, mat('balB', 0x4ec4e0, { roughness: 0.35 }), 0.12, 0.16, 0.04, 0.15, 0.19, 0.15);
  add(g, geo.sphere, mat('balY', 0xf0d23a, { roughness: 0.35 }), 0, 0.22, -0.1, 0.14, 0.18, 0.14);
  add(g, geo.cyl, mat('string', 0x888888), 0, -0.18, 0, 0.008, 0.4, 0.008);
  return g;
}

function banana(): THREE.Group {
  const g = group('banana_peel');
  const y = mat('peel', 0xf2d12b, { roughness: 0.55 });
  add(g, geo.box, y, 0, 0, 0, 0.1, 0.03, 0.36, 0, 0, 0.4);
  add(g, geo.box, y, 0.12, 0, 0.04, 0.08, 0.03, 0.3, 0, 0.4, -0.3);
  add(g, geo.box, y, -0.12, 0, 0.04, 0.08, 0.03, 0.3, 0, -0.4, 0.3);
  return g;
}

function whoopee(): THREE.Group {
  const g = group('whoopee');
  add(g, geo.cyl, mat('whoop', 0xc45a8a, { roughness: 0.7 }), 0, 0, 0, 0.22, 0.08, 0.22);
  add(g, geo.sphere, mat('whoopB', 0xa84872), 0, 0.04, 0, 0.16, 0.05, 0.16);
  return g;
}

function donut(): THREE.Group {
  const g = group('donut');
  add(g, geo.torus, mat('donut', 0xd48a4a, { roughness: 0.6 }), 0, 0, 0, 0.2, 0.2, 0.2, Math.PI / 2, 0, 0);
  add(g, geo.torus, mat('frost', 0xe07a9a, { roughness: 0.45 }), 0, 0.03, 0, 0.2, 0.2, 0.2, Math.PI / 2, 0, 0);
  return g;
}

function wheel(): THREE.Group {
  const g = group('wheel');
  add(g, geo.cyl, mat('tire', 0x222428, { roughness: 0.75 }), 0, 0, 0, 0.32, 0.16, 0.32, 0, 0, Math.PI / 2);
  add(g, geo.cyl, mat('rim', 0xc9ced4, { metalness: 0.85, roughness: 0.28 }), 0, 0, 0, 0.18, 0.12, 0.18, 0, 0, Math.PI / 2);
  return g;
}

function beachBall(): THREE.Group {
  const g = group('beach_ball');
  add(g, geo.sphere, mat('bb1', 0xff6b4a, { roughness: 0.4 }), 0, 0, 0, 0.38, 0.38, 0.38);
  add(g, geo.sphere, mat('bb2', 0x4ec4e0, { roughness: 0.4 }), 0, 0, 0, 0.381, 0.12, 0.381);
  return g;
}

function pin(): THREE.Group {
  const g = group('bowling_pin');
  add(g, geo.cyl, mat('pin', 0xf4f0e6), 0, -0.08, 0, 0.09, 0.36, 0.09);
  add(g, geo.sphere, mat('pinH', 0xf4f0e6), 0, 0.18, 0, 0.07, 0.09, 0.07);
  add(g, geo.cyl, mat('pinR', 0xd22b2b), 0, 0.02, 0, 0.092, 0.06, 0.092);
  return g;
}

function magnet(): THREE.Group {
  const g = group('magnet');
  add(g, geo.torus, mat('magR', 0xd22b2b, { metalness: 0.4 }), 0, 0, 0, 0.14, 0.14, 0.14, Math.PI / 2, 0, 0);
  add(g, geo.box, mat('magS', 0xc9ced4, { metalness: 0.8 }), -0.14, -0.08, 0, 0.08, 0.12, 0.1);
  add(g, geo.box, mat('magN', 0xc9ced4, { metalness: 0.8 }), 0.14, -0.08, 0, 0.08, 0.12, 0.1);
  return g;
}

function mattress(): THREE.Group {
  const g = group('mattress');
  add(g, geo.box, mat('matt', 0xe8e2d2, { roughness: 0.8 }), 0, 0, 0, 1.9, 0.24, 1.1);
  add(g, geo.box, mat('mattS', 0xd8d0be), 0, 0.08, 0, 1.7, 0.1, 0.9);
  return g;
}

function puck(): THREE.Group {
  const g = group('hockey_puck');
  add(g, geo.cyl, mat('puck', 0x141414, { roughness: 0.7 }), 0, 0, 0, 0.12, 0.05, 0.12);
  return g;
}

function spring(): THREE.Group {
  const g = group('giant_spring');
  const m = mat('spring', 0xc9ced4, { metalness: 0.85, roughness: 0.28 });
  for (let i = 0; i < 6; i++) {
    add(g, geo.torus, m, 0, -0.28 + i * 0.1, 0, 0.12, 0.12, 0.12, Math.PI / 2, 0, 0);
  }
  return g;
}

function tv(): THREE.Group {
  const g = group('tv');
  add(g, geo.box, mat('tvBody', 0x2a2d32, { roughness: 0.55 }), 0, 0, 0, 0.84, 0.64, 0.28);
  const screen = add(
    g,
    geo.box,
    new THREE.MeshStandardMaterial({
      color: 0x0a1020,
      emissive: new THREE.Color(0x1a2a40),
      emissiveIntensity: 0.15,
      roughness: 0.25,
    }),
    0,
    0.02,
    0.12,
    0.7,
    0.48,
    0.04,
    0,
    0,
    0,
    'screen',
  );
  screen.userData.role = 'screen';
  add(g, geo.box, mat('tvLeg', 0x1a1c20), -0.28, -0.36, 0, 0.06, 0.12, 0.16);
  add(g, geo.box, mat('tvLeg', 0x1a1c20), 0.28, -0.36, 0, 0.06, 0.12, 0.16);
  return g;
}

function radio(): THREE.Group {
  const g = group('radio');
  add(g, geo.box, mat('rad', 0xb45a28, { roughness: 0.7 }), 0, 0, 0, 0.44, 0.24, 0.18);
  add(g, geo.cyl, mat('radSpk', 0x2a2a2a), -0.1, 0, 0.1, 0.08, 0.02, 0.08, Math.PI / 2, 0, 0);
  add(g, geo.cyl, mat('radKnob', 0xd8c48a, { metalness: 0.4 }), 0.14, 0.04, 0.1, 0.03, 0.03, 0.03);
  add(g, geo.cyl, mat('radAnt', 0x888888, { metalness: 0.8 }), 0.16, 0.22, 0, 0.008, 0.22, 0.008);
  const led = add(
    g,
    geo.sphere,
    new THREE.MeshStandardMaterial({ color: 0x331111, emissive: new THREE.Color(0xff2200), emissiveIntensity: 0.1 }),
    0.16,
    -0.04,
    0.1,
    0.02,
    0.02,
    0.02,
    0,
    0,
    0,
    'led',
  );
  led.userData.role = 'led';
  return g;
}

function computer(): THREE.Group {
  const g = group('computer');
  add(g, geo.box, mat('pc', 0x8a9098, { metalness: 0.4, roughness: 0.5 }), 0, -0.08, -0.04, 0.36, 0.42, 0.28);
  add(g, geo.box, mat('mon', 0x2a2d32), 0, 0.18, 0.08, 0.5, 0.36, 0.06);
  const screen = add(
    g,
    geo.box,
    new THREE.MeshStandardMaterial({
      color: 0x061018,
      emissive: new THREE.Color(0x33ff88),
      emissiveIntensity: 0.12,
      roughness: 0.3,
    }),
    0,
    0.18,
    0.12,
    0.42,
    0.28,
    0.02,
    0,
    0,
    0,
    'screen',
  );
  screen.userData.role = 'screen';
  return g;
}

function door(): THREE.Group {
  const g = group('loose_door');
  add(g, geo.box, mat('door', 0x7a5a32, { roughness: 0.78 }), 0, 0, 0, 0.12, 2.1, 0.84);
  add(g, geo.box, mat('doorKnob', 0xd4b45a, { metalness: 0.7 }), 0.08, 0, 0.28, 0.04, 0.04, 0.08);
  return g;
}

function extinguisher(): THREE.Group {
  const g = group('extinguisher');
  add(g, geo.cyl, mat('ext', 0xc62828, { metalness: 0.55, roughness: 0.4 }), 0, -0.04, 0, 0.09, 0.52, 0.09);
  add(g, geo.cyl, mat('extTop', 0x2a2a2a, { metalness: 0.6 }), 0, 0.26, 0, 0.05, 0.08, 0.05);
  add(g, geo.cyl, mat('extHose', 0x222222), 0.08, 0.22, 0, 0.02, 0.16, 0.02, 0, 0, Math.PI / 2);
  add(g, geo.box, mat('extNoz', 0x888888, { metalness: 0.5 }), 0.16, 0.22, 0, 0.08, 0.04, 0.04);
  return g;
}

function broom(): THREE.Group {
  const g = group('broom');
  add(g, geo.cyl, mat('broomS', 0x8a6232, { roughness: 0.8 }), 0, 0.1, 0, 0.02, 1.2, 0.02);
  add(g, geo.box, mat('broomH', 0xc9a36a, { roughness: 0.85 }), 0, -0.52, 0, 0.22, 0.16, 0.08);
  return g;
}

function scooter(): THREE.Group {
  const g = group('scooter');
  const body = mat('scoot', 0x3aa0d8, { metalness: 0.45, roughness: 0.4 });
  add(g, geo.box, body, 0, -0.04, 0.04, 0.16, 0.05, 0.85);
  add(g, geo.cyl, body, 0, 0.18, -0.36, 0.025, 0.5, 0.025);
  add(g, geo.cyl, body, 0, 0.42, -0.36, 0.18, 0.03, 0.03, 0, 0, Math.PI / 2);
  const tire = mat('scootT', 0x222226);
  add(g, geo.cyl, tire, 0, -0.1, 0.4, 0.08, 0.04, 0.08, 0, 0, Math.PI / 2);
  add(g, geo.cyl, tire, 0, -0.1, -0.38, 0.08, 0.04, 0.08, 0, 0, Math.PI / 2);
  return g;
}

function lamp(): THREE.Group {
  const g = group('desk_lamp');
  add(g, geo.cyl, mat('lampB', 0xd6c24a, { metalness: 0.55 }), 0, -0.22, 0, 0.1, 0.04, 0.1);
  add(g, geo.cyl, mat('lampA', 0xc9b23a, { metalness: 0.5 }), 0, -0.02, 0, 0.02, 0.32, 0.02);
  add(g, geo.cone, mat('lampS', 0xe8d45a, { metalness: 0.4 }), 0, 0.22, 0.06, 0.1, 0.14, 0.1, -0.6, 0, 0);
  const bulb = add(
    g,
    geo.sphere,
    new THREE.MeshStandardMaterial({
      color: 0xfff4c8,
      emissive: new THREE.Color(0xffe08a),
      emissiveIntensity: 0.2,
    }),
    0,
    0.16,
    0.08,
    0.04,
    0.04,
    0.04,
    0,
    0,
    0,
    'bulb',
  );
  bulb.userData.role = 'bulb';
  const light = new THREE.PointLight(0xffe08a, 0, 4, 2);
  light.position.set(0, 0.18, 0.08);
  light.userData.role = 'light';
  g.add(light);
  return g;
}

export function setPropPowered(root: THREE.Group, on: boolean): void {
  root.traverse((obj) => {
    const role = obj.userData.role as string | undefined;
    if (obj instanceof THREE.PointLight && role === 'light') {
      obj.intensity = on ? 2.4 : 0;
      return;
    }
    if (!(obj instanceof THREE.Mesh) || !role) return;
    const material = obj.material;
    if (!(material instanceof THREE.MeshStandardMaterial)) return;
    if (role === 'screen') material.emissiveIntensity = on ? 1.35 : 0.12;
    if (role === 'led' || role === 'bulb') material.emissiveIntensity = on ? 2.2 : 0.12;
  });
}

export function disposeSharedPropVisuals(): void {
  for (const m of mats.values()) m.dispose();
  mats.clear();
}
