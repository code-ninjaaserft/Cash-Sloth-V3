export const eventPresetsMigration = {
  version: 7, name: 'event-presets',
  sql: `
CREATE TABLE event_presets (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TABLE active_event_preset (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), preset_id TEXT NOT NULL REFERENCES event_presets(id)) STRICT;
CREATE TABLE preset_operations (id TEXT PRIMARY KEY NOT NULL, request TEXT NOT NULL CHECK(json_valid(request)), state TEXT NOT NULL CHECK(json_valid(state))) STRICT;
`,
} as const;
