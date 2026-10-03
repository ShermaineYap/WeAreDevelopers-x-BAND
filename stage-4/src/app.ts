// HTTP wiring: routes, request decoding and the error envelope. Rules live in the modules
// each route calls; this file only decides the order of request-level checks.
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { authenticate, login, signup } from './auth';
import {
  API_BODY_LIMIT, EXPORT_FORMAT_VERSION, EXPORT_TRACK, PATH_MOVES, PATH_RESERVATIONS, PATH_SERIES,
  TEST_BODY_LIMIT, policiesPath,
} from './constants';
import { ApiError, malformed, notFound, validationFailed } from './errors';
import { stateFromFixture } from './fixture';
import { idempotencyKey, idempotent, type Outcome } from './idempotency';
import { listPolicies, publishPolicy, termsFor } from './policies';
import {
  amendReservation, cancelReservation, createReservation, getDecision, getHistory, getReservation,
  listReservations, moveReservations, occupancyOf,
} from './reservations';
import { adoptSeries, getSeries } from './series';
import { renderPage, SCREEN_ROUTES } from './pages';
import { slotsOn } from './schedule';
import { isObject, type JsonObject } from './shape';
import { deserializeState, findRestaurant, listRestaurants, replaceState, serializeState, snapshotState } from './state';
import { formatDate, parseDate } from './time';

const PLAIN_DIGITS = /^\d+$/;

/** The request body as a JSON object: unparseable or non-object bodies are 400. */
function jsonBody(req: Request): JsonObject {
  const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw malformed('The request body is not valid JSON');
  }
  if (!isObject(value)) throw malformed('The request body must be a JSON object');
  return value;
}

const userOf = (req: Request) => authenticate(req.get('authorization'));

/** The caller, or null when there is no valid token (owner-only reads answer 404 then). */
function optionalUserOf(req: Request): string | null {
  try {
    return userOf(req);
  } catch {
    return null;
  }
}

function send(res: Response, outcome: Outcome): void {
  if (outcome.status === 204) res.status(204).end();
  else res.status(outcome.status).json(outcome.body);
}

function sendError(res: Response, err: unknown): void {
  if (err instanceof ApiError) {
    res.status(err.status).json(err.toBody());
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Unexpected error' } });
}

type Handler = (req: Request) => Outcome | Promise<Outcome>;

const route = (handler: Handler) => async (req: Request, res: Response) => {
  try {
    send(res, await handler(req));
  } catch (err) {
    sendError(res, err);
  }
};

const ok = (body: unknown): Outcome => ({ status: 200, body });
const NO_CONTENT: Outcome = { status: 204, body: undefined };

// ---------- availability query (§5 query integers, §8) ----------

function availability(req: Request): Outcome {
  const params = new URL(req.originalUrl, 'http://localhost').searchParams;
  const value = (name: string) => {
    const v = params.get(name);
    if (v === null || v === '') throw validationFailed(`${name} is required`);
    return v;
  };
  const restaurantId = value('restaurant_id');
  const date = parseDate(value('date'));
  if (!date) throw validationFailed('date must be a calendar date YYYY-MM-DD');
  const party = value('party_size');
  if (!PLAIN_DIGITS.test(party) || Number(party) < 1) {
    throw validationFailed('party_size must be a positive integer written as plain decimal digits');
  }
  // Stage 3: `explain` is optional and its only accepted value is "true".
  const explain = params.get('explain');
  if (explain !== null && explain !== 'true') throw validationFailed('explain must be "true" when given');
  const restaurant = findRestaurant(restaurantId);
  if (!restaurant) throw notFound('No such restaurant');
  return ok({
    restaurant_id: restaurant.id,
    date: formatDate(date),
    timezone: restaurant.timezone,
    slots: slotsOn(restaurant, termsFor(restaurant, formatDate(date)), date, Number(party),
      occupancyOf(restaurant.id), explain === 'true'),
  });
}

// ---------- test control (§3.3, §10) ----------

async function reset(req: Request): Promise<Outcome> {
  replaceState(await stateFromFixture(jsonBody(req)));
  return NO_CONTENT;
}

function exportAll(): Outcome {
  return ok({ track: EXPORT_TRACK, format_version: EXPORT_FORMAT_VERSION, state: serializeState(snapshotState()) });
}

function importAll(req: Request): Outcome {
  const body = jsonBody(req);
  if (body.track !== EXPORT_TRACK) throw validationFailed(`track must be "${EXPORT_TRACK}"`);
  if (body.format_version !== EXPORT_FORMAT_VERSION) {
    throw validationFailed(`format_version must be ${EXPORT_FORMAT_VERSION}`);
  }
  replaceState(deserializeState(body.state));
  return NO_CONTENT;
}

// ---------- idempotent writes (§7): auth, body, key, then the idempotency record ----------

function idempotentWrite(
  path: string | ((req: Request) => string), run: (userId: string, body: JsonObject, req: Request) => Outcome,
): Handler {
  return (req) => {
    const userId = userOf(req);
    const body = jsonBody(req);
    const key = idempotencyKey(req.get('idempotency-key'));
    const scope = typeof path === 'string' ? path : path(req);
    return idempotent(userId, scope, key, body, () => run(userId, body, req));
  };
}

const param = (req: Request, name: string) => String(req.params[name]);

/** Browser assets (stylesheet and per-screen modules), shipped inside the image. */
const ASSETS_DIR = path.join(__dirname, '..', 'public');

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  const anyBody = (limit: string) => express.raw({ type: () => true, limit });
  app.use('/_test', anyBody(TEST_BODY_LIMIT));
  app.use(anyBody(API_BODY_LIMIT));

  // Screen routes return HTML (stage 2); everything else stays JSON.
  for (const [routePath, screen] of Object.entries(SCREEN_ROUTES)) {
    app.get(routePath, (_req, res) => {
      res.set('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(renderPage(screen));
    });
  }
  app.use('/assets', express.static(ASSETS_DIR, { fallthrough: true, maxAge: 0 }));

  app.get('/health', route(() => ok({ status: 'ok' })));
  app.post('/_test/reset', route(reset));
  app.get('/_test/export', route(exportAll));
  app.post('/_test/import', route(importAll));

  app.post('/auth/signup', route(async (req) => ({ status: 201, body: await signup(jsonBody(req)) })));
  app.post('/auth/login', route(async (req) => ok(await login(jsonBody(req)))));

  app.get('/restaurants', route(() =>
    ok({ restaurants: listRestaurants().map(({ id, name, timezone }) => ({ id, name, timezone })) })));
  app.get('/restaurants/:id', route((req) => {
    const restaurant = findRestaurant(param(req, 'id'));
    if (!restaurant) throw notFound('No such restaurant');
    return ok(restaurant);
  }));
  app.get('/restaurants/:id/policies', route((req) => listPolicies(param(req, 'id'))));
  app.post('/restaurants/:id/policies', route(idempotentWrite(
    (req) => policiesPath(param(req, 'id')),
    (userId, body, req) => publishPolicy(userId, param(req, 'id'), body))));
  app.get('/availability', route(availability));

  app.post(PATH_RESERVATIONS, route(idempotentWrite(PATH_RESERVATIONS, createReservation)));
  app.get('/reservations', route((req) => listReservations(userOf(req))));
  app.get('/reservations/:reference', route((req) => getReservation(userOf(req), param(req, 'reference'))));
  app.get('/reservations/:reference/history', route((req) => getHistory(optionalUserOf(req), param(req, 'reference'))));
  app.get('/reservations/:reference/decision', route((req) => getDecision(optionalUserOf(req), param(req, 'reference'))));
  app.post('/reservations/:reference/cancel', route((req) =>
    cancelReservation(userOf(req), param(req, 'reference'))));
  app.patch('/reservations/:reference', route((req) => {
    const userId = userOf(req);
    return amendReservation(userId, param(req, 'reference'), jsonBody(req));
  }));
  app.post(PATH_MOVES, route(idempotentWrite(PATH_MOVES, moveReservations)));
  app.post(PATH_SERIES, route(idempotentWrite(PATH_SERIES, adoptSeries)));
  app.get('/series/:id', route((req) => getSeries(optionalUserOf(req), param(req, 'id'))));

  app.use(route(() => {
    throw notFound('No such endpoint');
  }));

  // Framework-level failures still answer with the envelope: body-reading problems (oversized,
  // aborted, bad encoding) carry a body-parser `type`; anything else 4xx is about the URL,
  // e.g. a path segment with invalid percent-encoding.
  app.use((err: { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.too.large') {
      res.status(413).json(new ApiError(413, 'payload_too_large', 'The request body is too large').toBody());
    } else if (err.status && err.status < 500) {
      sendError(res, err.type
        ? malformed('The request body could not be read')
        : new ApiError(400, 'malformed_request', 'The request URL is not valid percent-encoding'));
    } else {
      sendError(res, err);
    }
  });
  return app;
}
