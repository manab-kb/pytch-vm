"use strict";

////////////////////////////////////////////////////////////////////////////////
//
// Module 'pytch.actor'

describe("pytch.actor module", () => {
    it("can be imported", () => {
        let import_result = import_local_file("py/actor/just_import.py");
        assert.ok(import_result.$d.Sprite);
        assert.ok(import_result.$d.Stage);
    });
});
