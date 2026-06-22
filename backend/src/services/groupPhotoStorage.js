const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');

/** Multer em memória — bytes vão para o PostgreSQL (persiste no redeploy da Hostinger). */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Apenas imagens são permitidas'));
  },
});

const GROUP_PUBLIC_COLUMNS = `
  id, name, photo_url, created_by, active, created_at, updated_at,
  daily_goal_value, weekly_goal_value, goal_points
`;

function photoApiPath(groupId) {
  return `/api/groups/${groupId}/photo`;
}

async function saveGroupPhoto(groupId, buffer, mime) {
  await db.query(
    `UPDATE groups
     SET photo_data = $1, photo_mime = $2, photo_url = $3, updated_at = NOW()
     WHERE id = $4`,
    [buffer, mime, photoApiPath(groupId), groupId]
  );
}

function stripPhotoBlob(row) {
  if (!row) return row;
  const { photo_data, photo_mime, ...rest } = row;
  return rest;
}

/** GET /api/groups/:id/photo — público (telão/ranking). */
async function serveGroupPhoto(req, res) {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      'SELECT photo_data, photo_mime, photo_url FROM groups WHERE id = $1 AND active = true',
      [id]
    );
    if (!rows.length) return res.status(404).end();

    const g = rows[0];
    if (g.photo_data) {
      res.set('Content-Type', g.photo_mime || 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(g.photo_data);
    }

    // Legado: arquivos em disco (dev local)
    if (g.photo_url?.startsWith('/uploads/')) {
      const rel = g.photo_url.replace(/^\//, '');
      const filePath = path.join(__dirname, '../..', rel);
      if (fs.existsSync(filePath)) {
        return res.sendFile(path.resolve(filePath));
      }
    }
    return res.status(404).end();
  } catch (err) {
    console.error('[GroupPhoto]', err);
    res.status(500).end();
  }
}

module.exports = {
  upload,
  GROUP_PUBLIC_COLUMNS,
  photoApiPath,
  saveGroupPhoto,
  stripPhotoBlob,
  serveGroupPhoto,
};
