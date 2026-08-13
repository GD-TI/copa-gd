const router = require('express').Router();
const { authMiddleware } = require('../middleware/auth');
const { responseCache } = require('../middleware/responseCache');
const { rankingMensal, digitadosDoDia, hojeBR, mesAtual } = require('../services/rankingIndividual');
const { lerCongelado, mesesCongelados } = require('../services/monthlyFreezer');

/**
 * Ranking individual da empresa: mensal por contratos pagos, diário por
 * contratos digitados.
 *
 * Substitui `/api/scores/individual-rankings` e `/api/scores/today-activity`,
 * que liam a Copa (`score_events` + só quem estava em equipe ativa). Aqueles
 * dois continuam de pé porque o card arquivado da Copa GD 2026 depende deles —
 * ver "Arquivo de campanhas legadas" no CLAUDE.md.
 *
 * Não há reset: "zera todo mês" e "zera todo dia" são a janela da consulta.
 */

const CACHE_VIVO = 60_000;
const CACHE_ENCERRADO = 10 * 60_000;

router.use(authMiddleware);

/** Meses disponíveis: o corrente (ao vivo) e os já congelados. */
router.get('/meses', responseCache(CACHE_VIVO), async (req, res) => {
  try {
    const congelados = await mesesCongelados();
    const atual = mesAtual();
    res.json({
      atual,
      meses: [
        { mes: atual, ao_vivo: true, congelado: false },
        ...congelados
          .filter(m => m.mes !== atual)
          .map(m => ({ ...m, ao_vivo: false, congelado: true })),
      ],
    });
  } catch (err) {
    console.error('[Rankings] meses:', err.message);
    res.status(500).json({ error: 'Erro ao listar meses' });
  }
});

/**
 * Ranking do mês por R$ pago.
 *
 * O congelado vence a API: mês encerrado é histórico e não pode mudar quando um
 * estorno for lançado meses depois. Mês sem foto (ainda não congelado, ou
 * congelamento adiado) cai no caminho ao vivo em vez de devolver vazio.
 */
router.get('/mensal', responseCache(CACHE_VIVO), async (req, res) => {
  const mes = req.query.mes || mesAtual();
  try {
    if (mes !== mesAtual()) {
      const congelado = await lerCongelado(mes);
      if (congelado) {
        res.locals.cacheTtlMs = CACHE_ENCERRADO;
        return res.json(congelado);
      }
    }

    const dados = await rankingMensal(mes);
    res.locals.cacheTtlMs = dados.ao_vivo ? CACHE_VIVO : CACHE_ENCERRADO;
    res.json(dados);
  } catch (err) {
    console.error('[Rankings] mensal:', err.message);
    // Mês malformado é erro de quem pediu, não da NewCorban.
    const status = /inválido/i.test(err.message) ? 400 : 502;
    res.status(status).json({ error: 'Não foi possível carregar o ranking do mês', detail: err.message });
  }
});

/** Contratos digitados no dia, por quantidade. */
router.get('/digitados', responseCache(CACHE_VIVO), async (req, res) => {
  const dia = req.query.date || hojeBR();
  try {
    const dados = await digitadosDoDia(dia);
    res.locals.cacheTtlMs = dados.ao_vivo ? CACHE_VIVO : CACHE_ENCERRADO;
    res.json(dados);
  } catch (err) {
    console.error('[Rankings] digitados:', err.message);
    const status = /inválida/i.test(err.message) ? 400 : 502;
    res.status(status).json({ error: 'Não foi possível carregar os digitados do dia', detail: err.message });
  }
});

module.exports = router;
