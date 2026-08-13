const express = require('express');
const { authMiddleware, attachFranquiaScopes } = require('../middleware/auth');
const { listarFranquias } = require('../services/franquiaSellers');

const router = express.Router();

/**
 * Catálogo de franquias, já recortado pelo escopo de quem pediu.
 *
 * Alimenta o passo de abrangência do formulário de campanha e o cadastro de
 * donos de franquia. A matriz recebe todas; o franqueado, só as suas — assim a
 * tela não precisa saber a regra, ela só desenha o que chegou.
 *
 * **Sem `responseCache` de propósito:** a chave dele é a URL, e esta resposta
 * muda por usuário — dois papéis diferentes na mesma URL serviriam a lista um do
 * outro. O custo real (o cadastro do NewCorban) já é cacheado 15 min dentro de
 * `getMapaFranquias`, então o que sobra aqui é só filtrar em memória.
 */
router.get('/', authMiddleware, attachFranquiaScopes, async (req, res) => {
  try {
    const todas = await listarFranquias();
    const escopo = req.franquiaIds;                    // null = todas (matriz)
    const franquias = escopo === null
      ? todas
      : todas.filter(f => escopo.includes(f.id));

    res.json({
      franquias,
      todas_as_franquias: escopo === null,             // pode criar campanha global
    });
  } catch (err) {
    console.error('[Franquias] catálogo:', err.message);
    res.status(502).json({
      error: 'Não foi possível ler o cadastro de franquias do NewCorban',
      detail: err.message,
    });
  }
});

module.exports = router;
