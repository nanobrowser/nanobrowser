// Where the fixture server answers (fixtures/server.mjs). Two hosts, so that a frame from the other one is cross-site.
export const FIXTURE_PORT = 8787;
export const FIXTURE_ORIGIN = `http://localhost:${FIXTURE_PORT}`;
export const FIXTURE_CROSS_ORIGIN = `http://127.0.0.1:${FIXTURE_PORT}`;
