var $builtinmodule = function (name) {
    let mod = {};

    ////////////////////////////////////////////////////////////////////////////////
    //
    // Constants, convenience utilities

    const FRAMES_PER_SECOND = 60;

    const s_dunder_name = Sk.builtin.str("__name__");
    const s_dunder_class = Sk.builtin.str("__class__");
    const s_im_func = Sk.builtin.str("im_func");
    const s_pytch_handler_for = Sk.builtin.str("_pytch_handler_for");
    const s_Costumes = Sk.builtin.str("Costumes");
    const s_shown = Sk.builtin.str("_shown");
    const s_x = Sk.builtin.str("_x");
    const s_y = Sk.builtin.str("_y");
    const s_size = Sk.builtin.str("_size");
    const s_appearance = Sk.builtin.str("_appearance");
    const s_pytch_parent_project = Sk.builtin.str("_pytch_parent_project");

    const name_of_py_class
          = (py_cls =>
             Sk.ffi.remapToJs(Sk.builtin.getattr(py_cls, s_dunder_name)));

    const js_hasattr = (py_obj, py_attr_name) => (
        (Sk.builtin.hasattr(py_obj, py_attr_name) === Sk.builtin.bool.true$));

    const try_py_getattr = (py_obj, py_attr_name) => (
        (js_hasattr(py_obj, py_attr_name)
         ? [true, Sk.builtin.getattr(py_obj, py_attr_name)]
         : [false, null]));

    const js_getattr = (py_obj, py_attr_name) => (
        Sk.ffi.remapToJs(Sk.builtin.getattr(py_obj, py_attr_name)));

    const map_concat
          = (fun, xs) => Array.prototype.concat.apply([], xs.map(fun));

    const next_global_id = (() => {
        let id = 1000;
        return () => {
            id += 1;
            return id;
        }
    })();


    ////////////////////////////////////////////////////////////////////////////////
    //
    // Appearance: A Sprite has Costumes; a Stage has Backdrops.  Refer to one
    // of either of these things as an "Appearance".

    class Appearance {
        constructor(image, centre_x, centre_y) {
            this.image = image;
            this.centre_x = centre_x;
            this.centre_y = centre_y;
        }

        static async async_create(url, centre_x, centre_y) {
            let image = await Sk.pytch.async_load_image(url);
            return new Appearance(image, centre_x, centre_y);
        }
    }


    ////////////////////////////////////////////////////////////////////////////////
    //
    // Rendering instructions.  To ease testing, there is no interaction here
    // with an actual canvas.  Instead, the project has a method which provides
    // a list of a list of rendering instructions.  These will in general be of
    // various types, but for now the only one is 'render this image here'.


    ////////////////////////////////////////////////////////////////////////////////
    //
    // RenderImage: A request that a particular image be drawn at a particular
    // location at a particular scale.  The 'location' is that of the top-left
    // corner.  The 'image label' is ignored in real rendering but is useful for
    // testing.
    //
    // (In due course, 'at a particular angle of rotation' will be added here.)

    class RenderImage {
        constructor(x, y, scale, image, image_label) {
            this.kind = "RenderImage";
            this.x = x;
            this.y = y;
            this.scale = scale;
            this.image = image;
            this.image_label = image_label;
        }
    }


    ////////////////////////////////////////////////////////////////////////////////
    //
    // BoundingBox: A rectangle which tightly encloses an image.

    class BoundingBox {
        constructor(x_min, x_max, y_min, y_max) {
            this.x_min = x_min;
            this.x_max = x_max;
            this.y_min = y_min;
            this.y_max = y_max;
        }

        overlaps_with(other_bbox) {
            return ((this.x_min < other_bbox.x_max)
                    && (other_bbox.x_min < this.x_max)
                    && (this.y_min < other_bbox.y_max)
                    && (other_bbox.y_min < this.y_max));
        }
    }


    ////////////////////////////////////////////////////////////////////////////////
    //
    // PytchActor: An actor (Sprite or Stage) within the Project.  It holds (a
    // reference to) the Python-level class (which should be derived from
    // pytch.Sprite or pytch.Stage), together with a list of its live instances.
    // There is always at least one live instance for a Sprite-derived actor;
    // other instances can be created as a result of clone() operations.  For
    // the Stage-derived actor, there is always exactly one instance.

    class PytchActor {
        constructor(py_cls, parent_project) {
            this.py_cls = py_cls;
            this.parent_project = parent_project;

            let py_instance = Sk.misceval.callsim(py_cls);
            let instance_0 = new PytchActorInstance(this, py_instance);
            py_instance.$pytchActorInstance = instance_0;
            this.instances = [instance_0];

            this.event_handlers = {
                green_flag: new EventHandlerGroup(),
                message: {},
            };

            this.clone_handlers = [];

            this.register_event_handlers();
        }

        get class_name() {
            return name_of_py_class(this.py_cls);
        }

        async async_load_appearances() {
            let attr_name = this.appearances_attr_name;
            let appearance_descriptors = js_getattr(this.py_cls, attr_name);

            let async_appearances = appearance_descriptors.map(async d => {
                let [url, cx, cy] = [d[1], d[2], d[3]];
                let appearance = await Appearance.async_create(url, cx, cy);
                return [d[0], appearance];
            });

            let appearances = await Promise.all(async_appearances);
            this._appearances = appearances;

            this._appearance_from_name = {};
            for (let [nm, app] of appearances)
                this._appearance_from_name[nm] = app;
        }

        async async_init() {
            await this.async_load_appearances();
        }

        appearance_from_name(appearance_name) {
            let appearance = this._appearance_from_name[appearance_name];

            if (typeof appearance == "undefined") {
                let cls_name = name_of_py_class(this.py_cls);
                let kind_name = this.appearance_single_name;

                throw Error(`could not find ${kind_name} "${appearance_name}"`
                            + ` in class "${cls_name}"`);
            }

            return appearance;
        }

        get n_appearances() {
            return this._appearances.length;
        }

        register_handler(event_descr, handler_py_func) {
            let [event_type, event_data] = event_descr;
            let handler = new EventHandler(this, handler_py_func);

            switch (event_type) {
            case "green-flag":
                this.event_handlers.green_flag.push(handler);
                break;

            case "message":
                let msg_handlers = this.event_handlers.message;
                if (! msg_handlers.hasOwnProperty(event_data))
                    msg_handlers[event_data] = new EventHandlerGroup();
                msg_handlers[event_data].push(handler);
                break;

            case "clone":
                this.clone_handlers.push(handler_py_func);
                break;

            default:
                throw Error(`unknown event-type "${event_type}"`);
            }
        }

        register_handlers_of_method(im_func) {
            let [has_events_handled, py_events_handled]
                = try_py_getattr(im_func, s_pytch_handler_for);

            if (! has_events_handled)
                return;

            let js_events_handled = Sk.ffi.remapToJs(py_events_handled);
            for (let js_event of js_events_handled) {
                this.register_handler(js_event, im_func);
            }
        }

        register_event_handlers() {
            let js_dir = Sk.ffi.remapToJs(Sk.builtin.dir(this.py_cls));

            for (let js_attr_name of js_dir) {
                let py_attr_name = Sk.builtin.str(js_attr_name);
                let attr_val = Sk.builtin.getattr(this.py_cls, py_attr_name);

                let [has_im_func, im_func] = try_py_getattr(attr_val, s_im_func);
                if (has_im_func)
                    this.register_handlers_of_method(im_func);
            }
        }

        unregister_instance(instance) {
            let instance_idx = this.instances.indexOf(instance);

            // Only allow de-registration of actual clones.  The test
            // 'instance_idx > 0' fails for two kinds of result from the
            // indexOf() call:
            //
            // If instance_idx == 0, then we have found this instance but it is
            // the 'original' instance of this actor-class.  So it can't be
            // deleted; it's not a true clone.
            //
            // If instance_idx == -1, then we could not find this instance at
            // all.  This seems like an error, but can happen if two threads
            // both try to unregister the same sprite in the same
            // scheduler-time-slice.
            //
            if (instance_idx > 0)
                this.instances.splice(instance_idx, 1);
        }

        create_threads_for_green_flag() {
            return this.event_handlers.green_flag.create_threads(this.parent_project);
        }

        create_threads_for_broadcast(js_message) {
            let event_handler_group = (this.event_handlers.message[js_message]
                                       || EventHandlerGroup.empty);
            return event_handler_group.create_threads(this.parent_project);
        }

        rendering_instructions() {
            return map_concat(i => i.rendering_instructions(),
                              this.instances);
        }
    }

    class PytchSprite extends PytchActor {
        static async async_create(py_cls, parent_project) {
            let sprite = new PytchSprite(py_cls, parent_project);
            await sprite.async_init();
            py_cls.$pytchActor = sprite;
            return sprite;
        }

        get appearances_attr_name() {
            return s_Costumes;
        }

        get appearance_single_name() {
            return "Costume";
        }
    }


    ////////////////////////////////////////////////////////////////////////////////
    //
    // PytchActorInstance: One instance of a particular actor.

    class PytchActorInstance {
        constructor(actor, py_object) {
            this.actor = actor;
            this.py_object = py_object;
            this.numeric_id = next_global_id();
            this.py_object_is_registered = true;
        }

        js_attr(js_attr_name) {
            return js_getattr(this.py_object, Sk.builtin.str(js_attr_name));
        }

        // Special-case these; they might be performance-sensitive.
        get render_shown() { return js_getattr(this.py_object, s_shown); }
        get render_x() { return js_getattr(this.py_object, s_x); }
        get render_y() { return js_getattr(this.py_object, s_y); }
        get render_size() { return js_getattr(this.py_object, s_size); }
        get render_appearance() { return js_getattr(this.py_object, s_appearance); }

        rendering_instructions() {
            if (! this.render_shown)
                return [];

            let size = this.render_size;
            let appearance_name = this.render_appearance;
            let appearance = this.actor.appearance_from_name(appearance_name);

            // The 'centre' of the image must end up at Stage coordinates
            // (this.render_x, this.render_y).  The strange arithmetic here is
            // because the centre-(x, y) coords of the image are most naturally
            // expressed in the normal image frame, i.e., (0, 0) is at the top
            // left, x increases rightwards, and y increases downwards.  We must
            // remap this into the Stage frame, where y increases upwards.
            //
            return [new RenderImage(this.render_x - size * appearance.centre_x,
                                    this.render_y + size * appearance.centre_y,
                                    size,
                                    appearance.image,
                                    appearance_name)];
        }

        bounding_box() {
            let size = this.render_size;
            let appearance_name = this.render_appearance;
            let appearance = this.actor.appearance_from_name(appearance_name);

            // Annoying mixture of addition and subtraction, and care needed
            // with respect to which is min and which is max, to account for the
            // different coordinate systems of appearance-centre vs stage.
            let x_min = this.render_x - size * appearance.centre_x;
            let y_max = this.render_y + size * appearance.centre_y;
            let x_max = x_min + size * appearance.image.width;
            let y_min = y_max - size * appearance.image.height;

            return new BoundingBox(x_min, x_max, y_min, y_max);
        }

        is_touching(other) {
            const both_shown = (this.render_shown && other.render_shown);

            if (! both_shown)
                return false;

            let bbox_0 = this.bounding_box();
            let bbox_1 = other.bounding_box();

            return bbox_0.overlaps_with(bbox_1);
        }

        unregister_self() {
            let actor = this.actor;
            actor.unregister_instance(this);

            this.py_object_is_registered = false;
        }
    }


    ////////////////////////////////////////////////////////////////////////////////
    //
    // Thread: One particular thread of execution.  Creating a new Thread
    // prepares to run the given Python callable with the single given argument.

    class Thread {
        constructor(py_callable, py_arg, parent_project) {
            // Fake a skulpt-suspension-like object so we can treat it the
            // same as any other suspension in the scheduler.
            this.skulpt_susp = {
                resume: () => Sk.misceval.callsimOrSuspend(py_callable, py_arg)
            };
            this.parent_project = parent_project;
            this.state = Thread.State.RUNNING;
            this.sleeping_on = null;

            this.actor_instance = py_arg.$pytchActorInstance;
            this.callable_name = js_getattr(py_callable, s_dunder_name);
        }

        is_running() {
            return this.state == Thread.State.RUNNING;
        }

        is_zombie() {
            return this.state == Thread.State.ZOMBIE;
        }

        get human_readable_sleeping_on() {
            switch (this.state) {
            case Thread.State.RUNNING:
                return "-";

            case Thread.State.AWAITING_THREAD_GROUP_COMPLETION:
                return `thread group [${this.sleeping_on.label}]`;

            case Thread.State.AWAITING_PASSAGE_OF_TIME:
                return `${this.sleeping_on} frames`;

            default:
                throw Error(`thread in bad state "${this.state}"`);
            }
        }

        should_wake() {
            switch (this.state) {
            case Thread.State.AWAITING_THREAD_GROUP_COMPLETION:
                return (! this.sleeping_on.has_live_threads());

            case Thread.State.AWAITING_PASSAGE_OF_TIME:
                this.sleeping_on -= 1;
                return (this.sleeping_on == 0);

            default:
                // This on purpose includes "RUNNING"; we should never ask
                // if an already-RUNNING thread is ready to wake up.
                throw Error(`thread in bad state "${this.state}"`);
            }
        }

        maybe_wake() {
            if ((! this.is_running()) && this.should_wake()) {
                this.state = Thread.State.RUNNING;
                this.sleeping_on = null;
            }
        }

        maybe_cull() {
            if (! this.actor_instance.py_object_is_registered) {
                this.state = Thread.State.ZOMBIE;
                this.sleeping_on = null;
            }
        }

        one_frame() {
            if (! this.is_running())
                return [];

            let susp_or_retval = this.skulpt_susp.resume();

            if (! susp_or_retval.$isSuspension) {
                // Python-land code ran to completion; thread is finished.
                this.skulpt_susp = null;
                this.state = Thread.State.ZOMBIE;
                return [];
            } else {
                // Python-land code invoked a syscall.

                let susp = susp_or_retval;
                if (susp.data.type !== "Pytch")
                    throw Error("cannot handle non-Pytch suspensions");

                switch (susp.data.subtype) {
                case "next-frame": {
                    // The thread remains running; update suspension so we
                    // continue running on the next frame.
                    this.skulpt_susp = susp;
                    return [];
                }

                case "broadcast": {
                    // The thread remains running, as in "next-frame".
                    this.skulpt_susp = susp;

                    let js_message = susp.data.subtype_data;
                    let new_thread_group
                        = (this.parent_project
                           .thread_group_for_broadcast_receivers(js_message));

                    return [new_thread_group];
                }

                case "broadcast-and-wait": {
                    // When it resumes, this thread will pick up here.
                    this.skulpt_susp = susp;

                    let js_message = susp.data.subtype_data;
                    let new_thread_group
                        = (this.parent_project
                           .thread_group_for_broadcast_receivers(js_message));

                    this.state = Thread.State.AWAITING_THREAD_GROUP_COMPLETION;
                    this.sleeping_on = new_thread_group;

                    return [new_thread_group];
                }

                case "wait-seconds": {
                    // When it resumes, this thread will pick up here.
                    this.skulpt_susp = susp;

                    let js_n_seconds = susp.data.subtype_data;
                    let raw_n_frames = Math.ceil(js_n_seconds * FRAMES_PER_SECOND);
                    let n_frames = (raw_n_frames < 1 ? 1 : raw_n_frames);

                    this.state = Thread.State.AWAITING_PASSAGE_OF_TIME;
                    this.sleeping_on = n_frames;

                    return [];
                }

                case "register-instance": {
                    // The thread remains running.
                    this.skulpt_susp = susp;

                    let py_instance = susp.data.subtype_data;
                    let py_cls = Sk.builtin.getattr(py_instance, s_dunder_class);
                    let actor = py_cls.$pytchActor;

                    let new_instance = new PytchActorInstance(actor, py_instance);
                    py_instance.$pytchActorInstance = new_instance;
                    actor.instances.push(new_instance);

                    let threads = actor.clone_handlers.map(
                        py_fun => new Thread(py_fun,
                                             py_instance,
                                             this.parent_project));

                    let new_thread_group = new ThreadGroup("start-as-clone", threads);
                    return [new_thread_group];
                }

                default:
                    throw Error(`unknown Pytch syscall "${susp.data.subtype}"`);
                }
            }
        }

        info() {
            let instance = this.actor_instance;
            return {
                target: (`${instance.actor.class_name}-${instance.numeric_id}`
                         + ` (${this.callable_name})`),
                state: this.state,
                wait: this.human_readable_sleeping_on,
            };
        }
    }

    Thread.State = {
        // RUNNING: The thread will be given a chance to run until either
        // completion or its next Pytch syscall.
        RUNNING: "running",

        // AWAITING_THREAD_GROUP_COMPLETION: The thread will not run again until
        // all the threads in the relevant thread-group have run to completion.
        // A reference to the 'relevant thread group' is stored in the Thread
        // instance's "sleeping_on" property.
        AWAITING_THREAD_GROUP_COMPLETION: "awaiting-thread-group-completion",

        // AWAITING_PASSAGE_OF_TIME: The thread will pause execution for the
        // number of frames stored in the "sleeping_on" property.  If this
        // number of frames is 1, the thread will resume at the next one_frame()
        // call.  If it's 2, the thread will remain non-runnable for the next
        // one_frame() call, and resume the one after that.  And so on.
        AWAITING_PASSAGE_OF_TIME: "awaiting-passage-of-time",

        // ZOMBIE: The thread has terminated but has not yet been cleared from
        // the list of live threads.
        ZOMBIE: "zombie",
    };


    ////////////////////////////////////////////////////////////////////////////////
    //
    // ThreadGroup: A collection of threads, all of which started in
    // response to the same event, such as green-flag or a message
    // being broadcast.

    class ThreadGroup {
        constructor(label, threads) {
            this.label = label;
            this.threads = threads;
        }

        has_live_threads() {
            return (this.threads.length > 0);
        }

        maybe_wake_threads() {
            this.threads.forEach(t => t.maybe_wake());
        }

        maybe_cull_threads() {
            this.threads.forEach(t => t.maybe_cull());
        }

        one_frame() {
            let new_thread_groups = map_concat(t => t.one_frame(), this.threads);

            this.threads = this.threads.filter(t => (! t.is_zombie()));

            if (this.has_live_threads())
                new_thread_groups.push(this);

            return new_thread_groups;
        }

        threads_info() {
            return this.threads.map(t => t.info());
        }
    }


    ////////////////////////////////////////////////////////////////////////////////
    //
    // EventHandler: A description of something which should happen in response
    // to some event, for example a green flag click, or the receipt of a
    // broadcast message.  Holds (a reference to) the PytchActor which will
    // respond to this event, and the function (instancemethod) within the
    // actor's class which will be called if the event happens.

    class EventHandler {
        constructor(pytch_actor, py_func) {
            this.pytch_actor = pytch_actor;
            this.py_func = py_func;
        }

        create_threads(parent_project) {
            return this.pytch_actor.instances.map(
                i => new Thread(this.py_func, i.py_object, parent_project));
        }
    }


    ////////////////////////////////////////////////////////////////////////////////
    //
    // EventHandlerGroup: A collection of EventHandlers all dealing with the same
    // event and all belonging to the same Actor.  A given Actor can have multiple
    // methods all decorated "@when_green_flag_clicked", for example.

    class EventHandlerGroup {
        constructor() {
            this.handlers = [];
        }

        push(handler) {
            this.handlers.push(handler);
        }

        get n_handlers() {
            return this.handlers.length;
        }

        create_threads(parent_project) {
            return map_concat(h => h.create_threads(parent_project), this.handlers);
        }
    }

    // A useful 'do nothing' instance.
    EventHandlerGroup.empty = new EventHandlerGroup();


    ////////////////////////////////////////////////////////////////////////////////
    //
    // Javascript-level "Project" class

    class Project {
        constructor() {
            this.actors = [];
            this.thread_groups = [];
        }

        actor_by_class_name(cls_name) {
            let actors_having_name
                = this.actors.filter(s => name_of_py_class(s.py_cls) == cls_name);

            if (actors_having_name.length > 1)
                throw Error(`duplicate PytchActors with name "${cls_name}"`);

            if (actors_having_name.length === 0)
                throw Error(`no PytchActors with name "${cls_name}"`);

            return actors_having_name[0];
        }

        instance_0_by_class_name(cls_name) {
            return this.actor_by_class_name(cls_name).instances[0];
        }

        async register_sprite_class(py_sprite_cls) {
            let sprite = await PytchSprite.async_create(py_sprite_cls, this);
            this.actors.push(sprite);
        }

        sprite_instances_are_touching(py_sprite_instance_0, py_sprite_instance_1) {
            let actor_instance_0 = py_sprite_instance_0.$pytchActorInstance;
            let actor_instance_1 = py_sprite_instance_1.$pytchActorInstance;

            // TODO: Proper pixel-wise collision detection.
            return actor_instance_0.is_touching(actor_instance_1);
        }

        instance_is_touching_any_of(py_sprite_instance, py_other_sprite_class) {
            let instance = py_sprite_instance.$pytchActorInstance;
            let other_sprite = py_other_sprite_class.$pytchActor;
            return other_sprite.instances.some(
                other_instance => instance.is_touching(other_instance));
        }

        unregister_actor_instance(py_actor_instance) {
            let actor_instance = py_actor_instance.$pytchActorInstance;
            actor_instance.unregister_self();
        }

        on_green_flag_clicked() {
            let threads = map_concat(a => a.create_threads_for_green_flag(), this.actors);
            let thread_group = new ThreadGroup("green-flag", threads);
            this.thread_groups.push(thread_group);
        }

        thread_group_for_broadcast_receivers(js_message) {
            let threads = map_concat(a => a.create_threads_for_broadcast(js_message),
                                     this.actors);
            return new ThreadGroup(`message "${js_message}"`, threads);
        }

        one_frame() {
            this.thread_groups.forEach(tg => tg.maybe_wake_threads());

            let new_thread_groups = map_concat(tg => tg.one_frame(),
                                               this.thread_groups);

            this.thread_groups = new_thread_groups;
        }

        rendering_instructions() {
            return map_concat(a => a.rendering_instructions(), this.actors);
        }

        do_synthetic_broadcast(js_msg) {
            let new_thread_group
                = this.thread_group_for_broadcast_receivers(js_msg);
            this.thread_groups.push(new_thread_group);
        }

        threads_info() {
            return map_concat(tg => tg.threads_info(), this.thread_groups);
        }
    }


    ////////////////////////////////////////////////////////////////////////////////
    //
    // Python-level "Project" class

    const project_cls = function($gbl, $loc) {
        $loc.__init__ = new Sk.builtin.func(self => {
            self.js_project = new Project();
        });

        $loc.instance_is_touching_any_of = new Sk.builtin.func(
            (self, instance, target_cls) => (
                (self.js_project.instance_is_touching_any_of(instance,
                                                             target_cls)
                 ? Sk.builtin.bool.true$
                 : Sk.builtin.bool.false$)));

        $loc.register_sprite_class = new Sk.builtin.func((self, sprite_cls) => {
            Sk.builtin.setattr(sprite_cls, s_pytch_parent_project, self);
            let do_register = self.js_project.register_sprite_class(sprite_cls);
            return Sk.misceval.promiseToSuspension(do_register);
        });

        $loc.unregister_actor_instance = new Sk.builtin.func((self, py_obj) => {
            self.js_project.unregister_actor_instance(py_obj);
        });
    };

    mod.Project = Sk.misceval.buildClass(mod, project_cls, "Project", []);


    ////////////////////////////////////////////////////////////////////////////////

    return mod;
};
