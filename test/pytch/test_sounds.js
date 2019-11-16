"use strict";

////////////////////////////////////////////////////////////////////////////////
//
// Sounds

describe("waiting and non-waiting sounds", () => {
    let one_frame_fun = (project => () => {
        mock_sound_manager.one_frame();
        project.one_frame();
    });

    let assert_running_performances = (exp_tags => {
        let got_tags = (mock_sound_manager.running_performances()
                        .map(p => p.tag));
        assert.deepStrictEqual(got_tags, exp_tags);
    });

    it("can play trumpet", async () => {
        let project = await import_project("py/project/make_noise.py");
        let orchestra = project.instance_0_by_class_name("Orchestra");
        let one_frame = one_frame_fun(project);

        project.do_synthetic_broadcast("play-trumpet");

        // On the next frame, the sound should start, but the launching
        // thread shouldn't have run again yet.
        one_frame();
        assert_running_performances(["trumpet"]);
        assert.strictEqual(orchestra.js_attr("played_trumpet"), "no")

        // On the next frame, the sound should still be playing, and the
        // launching thread will have run to completion.
        one_frame();
        assert_running_performances(["trumpet"]);
        assert.strictEqual(orchestra.js_attr("played_trumpet"), "yes")
        assert.strictEqual(project.thread_groups.length, 0);

        // For the rest of the length of the 'trumpet' sound, it should stay
        // playing.
        for (let i = 0; i != 18; ++i) {
            one_frame();
            assert_running_performances(["trumpet"]);
        }

        // And then silence should fall again:
        one_frame();
        assert_running_performances([]);
    });

    it("can play violin", async () => {
        let project = await import_project("py/project/make_noise.py");
        let orchestra = project.instance_0_by_class_name("Orchestra");
        let one_frame = one_frame_fun(project);

        project.do_synthetic_broadcast("play-violin");

        // On the next frame, the sound should start, and the launching
        // thread shouldn't have run again yet.
        one_frame();
        assert_running_performances(["violin"]);
        assert.strictEqual(orchestra.js_attr("played_violin"), "no")

        // For the rest of the length of the 'violin' sound, it should stay
        // playing, and the thread should remain sleeping.
        for (let i = 0; i != 9; ++i) {
            one_frame();
            assert_running_performances(["violin"]);
            assert.strictEqual(orchestra.js_attr("played_violin"), "no")
            assert.strictEqual(project.thread_groups.length, 1);
        }

        // And then silence should fall again as the thread runs to completion.
        one_frame();
        assert_running_performances([]);
        assert.strictEqual(orchestra.js_attr("played_violin"), "yes")
    });

    it("can play both", async () => {
        let project = await import_project("py/project/make_noise.py");
        let orchestra = project.instance_0_by_class_name("Orchestra");
        let one_frame = one_frame_fun(project);

        project.do_synthetic_broadcast("play-both");

        // On the next frame, the trumpet should start, but the launching
        // thread shouldn't have run again yet.
        one_frame();
        assert_running_performances(["trumpet"]);
        assert.strictEqual(orchestra.js_attr("played_both"), "no")

        // On the next frame, the violin should start, and the launching
        // thread should be sleeping.
        one_frame();
        assert_running_performances(["trumpet", "violin"]);
        assert.strictEqual(orchestra.js_attr("played_both"), "nearly")

        // For the rest of the length of the 'violin' sound, both sounds should
        // stay playing, and the thread should remain sleeping.
        for (let i = 0; i != 9; ++i) {
            one_frame();
            assert_running_performances(["trumpet", "violin"]);
            assert.strictEqual(orchestra.js_attr("played_both"), "nearly")
            assert.strictEqual(project.thread_groups.length, 1);
        }

        // For the rest of the length of the 'trumpet' sound, it alone should
        // stay playing, with the thread having run to completion.
        for (let i = 0; i != 9; ++i) {
            one_frame();
            assert_running_performances(["trumpet"]);
            assert.strictEqual(orchestra.js_attr("played_both"), "yes")
            assert.strictEqual(project.thread_groups.length, 0);
        }

        // And then silence should fall again.
        one_frame();
        assert_running_performances([]);
        assert.strictEqual(orchestra.js_attr("played_both"), "yes")
    });
});
