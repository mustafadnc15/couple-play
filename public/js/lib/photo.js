/** Helpers for user-supplied photos. */

export async function loadImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/** Center-crop an uploaded photo to 4:3 and shrink it so it travels well over the socket. */
export async function photoToDataUrl(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const target = 4 / 3;
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;
    if (sw / sh > target) sw = sh * target;
    else sh = sw / target;
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 720;
    canvas.getContext('2d').drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, 960, 720);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
