using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Wacs.Core;
using Wacs.Core.Runtime;
using Wacs.Core.Runtime.Types;
using Wacs.Core.Types;
using Wacs.Core.Types.Defs;

namespace CouchTor.Sports
{
    /// <summary>JavaScript's <c>undefined</c> (wasm-bindgen keeps it apart from <c>null</c>, which is ref.null).</summary>
    public sealed class JsUndefined
    {
        public static readonly JsUndefined Value = new JsUndefined();
        public override string ToString() => "undefined";
    }

    /// <summary>A plain JavaScript object: string-keyed properties.</summary>
    public class JsObject
    {
        readonly Dictionary<string, object> props = new Dictionary<string, object>();
        public readonly string Kind;

        public JsObject(string kind = "Object") { Kind = kind; }

        public object Get(string key) => props.TryGetValue(key, out var v) ? v : JsUndefined.Value;
        public void Set(string key, object value) => props[key] = value;
        public override string ToString() => Kind;
    }

    public sealed class JsFunction : JsObject
    {
        readonly Func<object[], object> body;
        public JsFunction(string name, Func<object[], object> body) : base("function " + name) { this.body = body; }
        public object Call(params object[] args) => body(args) ?? JsUndefined.Value;
    }

    public sealed class JsArray : JsObject
    {
        public readonly List<object> Items;
        public JsArray(params object[] items) : base("Array") { Items = new List<object>(items); }
    }

    /// <summary>A Uint8Array or ArrayBuffer.</summary>
    public sealed class JsBytes : JsObject
    {
        public readonly byte[] Data;
        public JsBytes(byte[] data, string kind) : base(kind) { Data = data; }
    }

    public sealed class JsHeaders : JsObject
    {
        public readonly Dictionary<string, string> Values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public JsHeaders() : base("Headers") { }
    }

    public sealed class JsRequest : JsObject
    {
        public string Url, Method = "GET", Mode;
        public byte[] Body;
        public readonly JsHeaders Headers = new JsHeaders();
        public JsRequest() : base("Request") { }
    }

    public sealed class JsResponse : JsObject
    {
        public int Status;
        public string Url;
        public byte[] Body = new byte[0];
        public readonly JsHeaders Headers = new JsHeaders();
        public JsResponse() : base("Response") { }
    }

    /// <summary>A thrown JavaScript value.</summary>
    public sealed class JsException : Exception
    {
        public readonly object Value;
        public JsException(object value) : base("JavaScript exception: " + value) { Value = value; }
    }

    /// <summary>A Promise whose callbacks run as microtasks of its <see cref="JsHost"/>.</summary>
    public sealed class JsPromise : JsObject
    {
        readonly JsHost host;
        int state; // 0 pending, 1 fulfilled, 2 rejected
        object value;
        readonly List<(Action<object> ok, Action<object> fail)> waiters = new List<(Action<object>, Action<object>)>();

        public JsPromise(JsHost host) : base("Promise") { this.host = host; }

        public void Resolve(object v)
        {
            if (state != 0)
                return;
            if (v is JsPromise other)
            {
                other.Subscribe(Resolve, Reject);
                return;
            }
            state = 1;
            value = v;
            Flush();
        }

        public void Reject(object reason)
        {
            if (state != 0)
                return;
            state = 2;
            value = reason;
            Flush();
        }

        public void Subscribe(Action<object> ok, Action<object> fail)
        {
            waiters.Add((ok, fail));
            if (state != 0)
                Flush();
        }

        void Flush()
        {
            var list = waiters.ToList();
            waiters.Clear();
            foreach (var (ok, fail) in list)
                host.Microtask(() => { if (state == 1) ok(value); else fail(value); });
        }

        public JsPromise Then(JsFunction onFulfilled, JsFunction onRejected)
        {
            var next = new JsPromise(host);
            Subscribe(v => Settle(next, onFulfilled, v, true), e => Settle(next, onRejected, e, false));
            return next;
        }

        static void Settle(JsPromise next, JsFunction handler, object v, bool fulfilled)
        {
            if (handler == null)
            {
                if (fulfilled) next.Resolve(v); else next.Reject(v);
                return;
            }
            try { next.Resolve(handler.Call(v)); }
            catch (JsException e) { next.Reject(e.Value); }
        }
    }

    /// <summary>
    /// Runs a wasm-bindgen module (built for the browser) in WACS with just enough of a browser around it: the
    /// glue wasm-bindgen would generate in JavaScript, written for the imports the sports resolver uses, a
    /// Promise/microtask loop, and fetch over HTTP. Code the module asks to evaluate is refused, never run.
    /// One instance per resolution; not thread-safe (everything runs on the thread calling <see cref="Run"/>).
    /// </summary>
    public sealed class JsHost
    {
        readonly WasmRuntime runtime = new WasmRuntime();
        readonly List<object> refs = new List<object> { null }; // externref handles; 0 is never used
        readonly Queue<Action> microtasks = new Queue<Action>();
        readonly BlockingCollection<Action> tasks = new BlockingCollection<Action>();
        readonly Func<JsRequest, CancellationToken, Task<JsResponse>> fetch;
        readonly List<WasmFunction> exports;
        MemoryInstance memory;
        TableInstance table;
        Delegates.StackFunc malloc, tableAlloc;
        readonly Dictionary<string, Delegates.StackFunc> invokers = new Dictionary<string, Delegates.StackFunc>();
        string closure0, closure1, executor;
        CancellationToken token;

        public readonly JsObject Window = new JsObject("Window"), Document = new JsObject("HTMLDocument");
        /// <summary>Every URL the module builds a Request for, in order.</summary>
        public readonly List<string> RequestUrls = new List<string>();
        public readonly List<string> Log = new List<string>();
        /// <summary>Milliseconds per phase, for diagnostics.</summary>
        public readonly List<string> Timings = new List<string>();
        readonly System.Diagnostics.Stopwatch clock = System.Diagnostics.Stopwatch.StartNew();
        public void Mark(string what) => Timings.Add(what + " @" + clock.ElapsedMilliseconds);
        /// <summary>Imports the module declares that this host doesn't implement (called = failure).</summary>
        public readonly List<string> Missing = new List<string>();

        /// <summary>When set before construction, every import call is reported (diagnostics).</summary>
        public static Action<string> Trace;

        string Show(Value v) => v.Type == ValType.ExternRef ? (v.IsNullRef ? "null" : "#" + v.Data.Int64 + ":" + (refs[(int)v.Data.Int64] ?? "null")) : v.Type == ValType.F64 ? v.Data.Float64.ToString() : v.Data.Int32.ToString();

        /// <param name="skipValidation">For a module this process has already validated (validation dominates
        /// instantiation on the TV: ~26 s).</param>
        public JsHost(byte[] wasm, string hostname, string userAgent, Func<JsRequest, CancellationToken, Task<JsResponse>> fetch, bool skipValidation = false)
        {
            this.fetch = fetch;
            var location = new JsObject("Location");
            location.Set("hostname", hostname);
            var navigator = new JsObject("Navigator");
            navigator.Set("userAgent", userAgent);
            Window.Set("location", location);
            Window.Set("document", Document);
            Window.Set("navigator", navigator);
            Window.Set("queueMicrotask", new JsFunction("queueMicrotask", a =>
            {
                var f = a.Length > 0 ? a[0] as JsFunction : null;
                if (f != null) Microtask(() => f.Call());
                return null;
            }));
            Document.Set("location", location);

            var (imports, exported) = WasmBinary.Functions(wasm);
            exports = exported;
            foreach (var imp in imports)
            {
                var body = Implementation(imp);
                var shown = Hash.Replace(imp.Name.Replace("__wbg_", ""), "");
                runtime.BindHostFunction((imp.Module, imp.Name), new Import(imp, Trace == null ? body : a =>
                {
                    var r = body(a);
                    Trace(shown + "(" + string.Join(", ", a.Select(Show)) + ")" + (imp.Results.Length > 0 ? " -> " + Show(r) : ""));
                    return r;
                }));
            }
            var watch = System.Diagnostics.Stopwatch.StartNew();
            var module = BinaryModuleParser.ParseWasm(new MemoryStream(wasm));
            Timings.Add("parse " + watch.ElapsedMilliseconds);
            watch.Restart();
            var instance = runtime.InstantiateModule(module, new RuntimeOptions { SkipModuleValidation = skipValidation });
            Timings.Add("instantiate " + watch.ElapsedMilliseconds);
            runtime.RegisterModule("m", instance);
            if (!runtime.TryGetExportedMemory(("m", "memory"), out memory) || !runtime.TryGetExportedTable(("m", "__wbindgen_externrefs"), out table))
                throw new InvalidDataException("not a wasm-bindgen module with externrefs");
            malloc = Export("__wbindgen_malloc");
            tableAlloc = Export("__externref_table_alloc");
            // Closure trampolines, found by shape: their names carry a hash that changes with every build.
            foreach (var e in exports.Where(e => e.Name.StartsWith("wasm_bindgen__convert__closures_____invoke__", StringComparison.Ordinal)))
            {
                var sig = e.Signature;
                if (sig == "(i32,i32)->()") closure0 = e.Name;
                else if (sig == "(i32,i32,externref)->()") closure1 = e.Name;
                else if (sig == "(i32,i32,externref,externref)->()") executor = e.Name;
            }
        }

        public Delegates.StackFunc Export(string name)
        {
            if (!invokers.TryGetValue(name, out var f))
            {
                if (!runtime.TryGetExportedFunction(("m", name), out var addr))
                    throw new InvalidDataException("module has no export " + name);
                invokers[name] = f = runtime.CreateStackInvoker(addr);
            }
            return f;
        }

        public bool HasExport(string name) => exports.Any(e => e.Name == name);

        // ---- event loop ----

        public void Microtask(Action a) => microtasks.Enqueue(a);

        void Drain()
        {
            while (microtasks.Count > 0)
                microtasks.Dequeue()();
        }

        /// <summary>Calls <paramref name="start"/>, then runs microtasks and fetch completions until <paramref name="done"/> or the timeout.</summary>
        public void Run(Action start, Func<bool> done, TimeSpan timeout, CancellationToken cancel)
        {
            token = cancel;
            start();
            Drain();
            var deadline = DateTime.UtcNow + timeout;
            while (!done())
            {
                var left = deadline - DateTime.UtcNow;
                if (left <= TimeSpan.Zero)
                    throw new TimeoutException("the module didn't finish in " + timeout.TotalSeconds + " s");
                if (tasks.TryTake(out var task, (int)Math.Min(left.TotalMilliseconds, 200), cancel))
                {
                    task();
                    Drain();
                }
            }
        }

        // ---- values ----

        public static int I32(Value v) => v.Data.Int32;

        public object Ref(Value v) => v.IsNullRef ? null : refs[(int)v.Data.Int64];

        public Value ToRef(object o)
        {
            if (o == null)
                return new Value(ValType.ExternRef);
            refs.Add(o);
            return new Value(ValType.ExternRef, (ulong)(refs.Count - 1));
        }

        /// <summary>wasm-bindgen's Option&lt;JsValue&gt; returned as an i32 slot in its externref table (0 = none).</summary>
        Value OptionalSlot(object o)
        {
            if (o == null || o is JsUndefined)
                return new Value(0);
            int slot = I32(tableAlloc(new Value[0])[0]);
            table.Elements[slot] = ToRef(o);
            return new Value(slot);
        }

        public string ReadString(int ptr, int len) => Encoding.UTF8.GetString(memory.Data, ptr, len);

        public (int ptr, int len) PassString(string s)
        {
            var bytes = Encoding.UTF8.GetBytes(s);
            int ptr = I32(malloc(new[] { new Value(bytes.Length), new Value(1) })[0]);
            Buffer.BlockCopy(bytes, 0, memory.Data, ptr, bytes.Length);
            return (ptr, bytes.Length);
        }

        void WriteInt32(int at, int v)
        {
            var d = memory.Data;
            d[at] = (byte)v; d[at + 1] = (byte)(v >> 8); d[at + 2] = (byte)(v >> 16); d[at + 3] = (byte)(v >> 24);
        }

        /// <summary>Option&lt;String&gt; written to a return slot: [ptr, len], ptr 0 for none.</summary>
        void WriteOptionalString(int ret, object s)
        {
            if (!(s is string str))
            {
                WriteInt32(ret, 0);
                WriteInt32(ret + 4, 0);
                return;
            }
            var (ptr, len) = PassString(str);
            WriteInt32(ret + 4, len);
            WriteInt32(ret, ptr);
        }

        JsFunction Closure(string invoke, int a, int b, int arity) => new JsFunction("closure", args =>
        {
            var p = new List<Value> { new Value(a), new Value(b) };
            for (int i = 0; i < arity; i++)
                p.Add(ToRef(i < args.Length ? args[i] : JsUndefined.Value));
            Export(invoke)(p.ToArray());
            return null;
        });

        // ---- imports ----

        delegate Value Body(Value[] args);

        sealed class Import : IFunctionInstance
        {
            readonly Body body;
            readonly bool returns;
            public Import(WasmFunction f, Body body)
            {
                this.body = body;
                Name = f.Name;
                Id = f.Module + "." + f.Name;
                Type = new FunctionType(new ResultType(f.Params.Select(Val).ToArray()), new ResultType(f.Results.Select(Val).ToArray()));
                returns = f.Results.Length > 0;
            }
            public FunctionType Type { get; }
            public string Id { get; }
            public bool IsAsync => false;
            public string Name { get; private set; }
            public bool IsExport { get; set; }
            public void SetName(string name) { }
            public void Invoke(ExecContext context)
            {
                var args = new Value[Type.ParameterTypes.Arity];
                for (int i = args.Length - 1; i >= 0; i--)
                    args[i] = context.OpStack.PopAny();
                // The glue calls back into the module from here (malloc, table alloc). WACS treats a call made while
                // the operand stack is empty as top-level and doesn't restore the caller's position, and leaves a
                // nested call's results on the stack. A placeholder keeps the stack non-empty; afterwards everything
                // down to and including it is dropped.
                int depth = context.OpStack.Count;
                context.OpStack.PushValue(new Value(0));
                Value result;
                try { result = body(args); }
                finally
                {
                    while (context.OpStack.Count > depth)
                        context.OpStack.PopAny();
                }
                if (returns)
                    context.OpStack.PushValue(result);
            }

            static ValType Val(byte t)
            {
                switch (t)
                {
                    case WasmBinary.I32: return ValType.I32;
                    case WasmBinary.I64: return ValType.I64;
                    case WasmBinary.F32: return ValType.F32;
                    case WasmBinary.F64: return ValType.F64;
                    case WasmBinary.ExternRef: return ValType.ExternRef;
                    case WasmBinary.FuncRef: return ValType.FuncRef;
                    default: throw new InvalidDataException("unsupported value type 0x" + t.ToString("x2"));
                }
            }
        }

        static readonly Regex Hash = new Regex("_[0-9a-f]{16}$");

        static readonly Value None = default;
        Value Bool(bool b) => new Value(b ? 1 : 0);

        /// <summary>
        /// The wasm-bindgen glue for one import, chosen by its name without the build hash, and by signature where
        /// one name has several forms. An import this host doesn't know fails loudly when called.
        /// </summary>
        Body Implementation(WasmFunction f)
        {
            var name = f.Name;
            var shortName = name.StartsWith("__wbg_", StringComparison.Ordinal) ? Hash.Replace(name.Substring(6), "") : name;
            int arity = f.Params.Length;
            bool returns = f.Results.Length > 0;
            if (name.StartsWith("__wbindgen_cast_", StringComparison.Ordinal))
            {
                // Casts are numbered per build, not named. In this build: 1 and 2 make closures, 3 a number, 4 a string.
                if (f.Params.Length == 1 && f.Params[0] == WasmBinary.F64)
                    return a => ToRef(a[0].Data.Float64);
                switch (name.Substring(name.Length - 1))
                {
                    case "1": return a => ToRef(Closure(closure1, I32(a[0]), I32(a[1]), 1));
                    case "2": return a => ToRef(Closure(closure0, I32(a[0]), I32(a[1]), 0));
                    default: return a => ToRef(ReadString(I32(a[0]), I32(a[1])));
                }
            }
            switch (shortName)
            {
                case "__wbindgen_init_externref_table":
                    return a =>
                    {
                        int offset = table.Elements.Count;
                        table.Grow(4, new Value(ValType.ExternRef));
                        table.Elements[0] = ToRef(JsUndefined.Value);
                        table.Elements[offset] = ToRef(JsUndefined.Value);
                        table.Elements[offset + 1] = ToRef(null);
                        table.Elements[offset + 2] = ToRef(true);
                        table.Elements[offset + 3] = ToRef(false);
                        return None;
                    };
                case "static_accessor_SELF":
                case "static_accessor_WINDOW":
                case "static_accessor_GLOBAL_THIS":
                    return a => OptionalSlot(Window);
                case "static_accessor_GLOBAL":
                    return a => OptionalSlot(null);
                case "__wbindgen_is_undefined": return a => Bool(Ref(a[0]) is JsUndefined);
                case "__wbindgen_is_null": return a => Bool(Ref(a[0]) == null);
                case "__wbindgen_is_function": return a => Bool(Ref(a[0]) is JsFunction);
                case "__wbindgen_boolean_get": return a => new Value(Ref(a[0]) is bool b ? (b ? 1 : 0) : 0xFFFFFF);
                case "__wbindgen_string_get": return a => { WriteOptionalString(I32(a[0]), Ref(a[1])); return None; };
                case "__wbindgen_number_get":
                    return a =>
                    {
                        int ret = I32(a[0]);
                        var n = Ref(a[1]);
                        var bytes = BitConverter.GetBytes(n is double d ? d : 0);
                        Buffer.BlockCopy(bytes, 0, memory.Data, ret + 8, 8);
                        WriteInt32(ret, n is double ? 1 : 0);
                        return None;
                    };
                case "__wbindgen_throw": return a => throw new JsException(ReadString(I32(a[0]), I32(a[1])));
                case "_wbg_cb_unref": return a => None; // closures live as long as this one-shot host
                case "queueMicrotask":
                    if (returns) return a => ToRef(((JsObject)Ref(a[0])).Get("queueMicrotask"));
                    return a => { var fn = Ref(a[0]) as JsFunction; Microtask(() => fn.Call()); return None; };
                case "resolve": return a => { var p = new JsPromise(this); p.Resolve(Ref(a[0])); return ToRef(p); };
                case "then":
                    return a => ToRef(((JsPromise)Ref(a[0])).Then(Ref(a[1]) as JsFunction, arity > 2 ? Ref(a[2]) as JsFunction : null));
                case "new":
                    if (arity == 2) // new Promise(executor): the executor is a closure (a, b) over the module
                        return a =>
                        {
                            var p = new JsPromise(this);
                            var resolve = new JsFunction("resolve", x => { p.Resolve(x.Length > 0 ? x[0] : JsUndefined.Value); return null; });
                            var reject = new JsFunction("reject", x => { p.Reject(x.Length > 0 ? x[0] : JsUndefined.Value); return null; });
                            Export(executor)(new[] { a[0], a[1], ToRef(resolve), ToRef(reject) });
                            return ToRef(p);
                        };
                    if (arity == 1) // new Uint8Array(buffer)
                        return a => ToRef(new JsBytes(((JsBytes)Ref(a[0])).Data, "Uint8Array"));
                    return a => ToRef(new JsObject());
                case "instanceof_Window": return a => Bool(Ref(a[0]) == Window);
                case "instanceof_Document": return a => Bool(Ref(a[0]) == Document);
                case "instanceof_Response": return a => Bool(Ref(a[0]) is JsResponse);
                case "instanceof_Promise": return a => Bool(Ref(a[0]) is JsPromise);
                case "document": return a => OptionalSlot(((JsObject)Ref(a[0])).Get("document"));
                case "navigator": return a => ToRef(((JsObject)Ref(a[0])).Get("navigator"));
                case "userAgent": return a => { WriteOptionalString(I32(a[0]), ((JsObject)Ref(a[1])).Get("userAgent")); return None; };
                case "get":
                    if (arity == 4) // Headers.get(name) into a return slot
                        return a =>
                        {
                            var h = (JsHeaders)Ref(a[1]);
                            WriteOptionalString(I32(a[0]), h.Values.TryGetValue(ReadString(I32(a[2]), I32(a[3])), out var v) ? v : null);
                            return None;
                        };
                    return a => ToRef(Ref(a[0]) is JsObject o && Ref(a[1]) is string key ? o.Get(key) : JsUndefined.Value);
                case "set":
                    if (arity == 5) // Headers.set(name, value)
                        return a => { ((JsHeaders)Ref(a[0])).Values[ReadString(I32(a[1]), I32(a[2]))] = ReadString(I32(a[3]), I32(a[4])); return None; };
                    return a => { if (Ref(a[0]) is JsObject o && Ref(a[1]) is string key) o.Set(key, Ref(a[2])); return new Value(1); };
                case "set_method": return a => { ((JsObject)Ref(a[0])).Set("method", ReadString(I32(a[1]), I32(a[2]))); return None; };
                case "set_mode": return a => { ((JsObject)Ref(a[0])).Set("mode", I32(a[1])); return None; };
                case "set_body": return a => { ((JsObject)Ref(a[0])).Set("body", Ref(a[1])); return None; };
                case "new_from_slice":
                    return a =>
                    {
                        var data = new byte[I32(a[1])];
                        Buffer.BlockCopy(memory.Data, I32(a[0]), data, 0, data.Length);
                        return ToRef(new JsBytes(data, "Uint8Array"));
                    };
                case "length": return a => new Value(((JsBytes)Ref(a[0])).Data.Length);
                case "prototypesetcall": // Uint8Array.prototype.set.call(view of wasm memory, array)
                    return a =>
                    {
                        var src = ((JsBytes)Ref(a[2])).Data;
                        Buffer.BlockCopy(src, 0, memory.Data, I32(a[0]), Math.Min(I32(a[1]), src.Length));
                        return None;
                    };
                case "new_with_str_and_init":
                    return a =>
                    {
                        var init = (JsObject)Ref(a[2]);
                        var url = ReadString(I32(a[0]), I32(a[1]));
                        var origin = "https://" + ((JsObject)Window.Get("location")).Get("hostname") + "/";
                        var request = new JsRequest
                        {
                            Url = new Uri(new Uri(origin), url).AbsoluteUri,
                            Method = init.Get("method") as string ?? "GET",
                            Body = (init.Get("body") as JsBytes)?.Data,
                        };
                        RequestUrls.Add(request.Url);
                        Mark("request built");
                        return ToRef(request);
                    };
                case "headers": return a => ToRef(Ref(a[0]) is JsRequest r ? r.Headers : ((JsResponse)Ref(a[0])).Headers);
                case "fetch":
                    return a =>
                    {
                        var request = (JsRequest)Ref(a[1]);
                        Mark("fetch " + request.Method);
                        var p = new JsPromise(this);
                        fetch(request, token).ContinueWith(t => tasks.Add(() =>
                        {
                            Mark("response");
                            if (t.Status == TaskStatus.RanToCompletion) p.Resolve(t.Result);
                            else p.Reject(new JsObject("TypeError: Failed to fetch"));
                        }));
                        return ToRef(p);
                    };
                case "ok": return a => Bool(((JsResponse)Ref(a[0])).Status >= 200 && ((JsResponse)Ref(a[0])).Status <= 299);
                case "arrayBuffer": return a => { var p = new JsPromise(this); p.Resolve(new JsBytes(((JsResponse)Ref(a[0])).Body, "ArrayBuffer")); return ToRef(p); };
                case "text": return a => { var p = new JsPromise(this); p.Resolve(Encoding.UTF8.GetString(((JsResponse)Ref(a[0])).Body)); return ToRef(p); };
                case "call": // Function.prototype.call(f, this, ...args)
                    return a =>
                    {
                        if (!(Ref(a[0]) is JsFunction fn))
                            throw new JsException("TypeError: not a function");
                        return ToRef(fn.Call(a.Skip(2).Select(Ref).ToArray()));
                    };
                case "of": return a => ToRef(new JsArray(Ref(a[0])));
                case "push": return a => { var list = (JsArray)Ref(a[0]); list.Items.Add(Ref(a[1])); return new Value(list.Items.Count); };
                case "eval":
                case "new_no_args":
                    // The module may ask for code to run (player setup); this host never runs foreign code.
                    return a => { Log.Add(shortName + " refused: " + Short(ReadString(I32(a[0]), I32(a[1])))); return ToRef(JsUndefined.Value); };
                default:
                    Missing.Add(shortName + f.Signature);
                    return a => throw new NotSupportedException("browser function not provided: " + shortName + f.Signature);
            }
        }

        static string Short(string s) => s.Length > 80 ? s.Substring(0, 80) + "…" : s;
    }
}
