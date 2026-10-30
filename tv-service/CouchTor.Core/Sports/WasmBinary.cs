using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace CouchTor.Sports
{
    /// <summary>A function a wasm module imports or exports, with its signature as value-type bytes.</summary>
    public sealed class WasmFunction
    {
        public string Module, Name;
        public byte[] Params, Results;

        public string Signature => "(" + string.Join(",", Array.ConvertAll(Params, WasmBinary.TypeName)) + ")->(" +
            string.Join(",", Array.ConvertAll(Results, WasmBinary.TypeName)) + ")";
    }

    /// <summary>
    /// Reads a module's function imports and exports from its binary, so the host can match imports by name and
    /// signature (wasm-bindgen's hash suffixes change with every build) and find exports by their shape.
    /// </summary>
    public static class WasmBinary
    {
        public const byte I32 = 0x7f, I64 = 0x7e, F32 = 0x7d, F64 = 0x7c, ExternRef = 0x6f, FuncRef = 0x70;

        public static string TypeName(byte t)
        {
            switch (t)
            {
                case I32: return "i32";
                case I64: return "i64";
                case F32: return "f32";
                case F64: return "f64";
                case ExternRef: return "externref";
                case FuncRef: return "funcref";
                default: return "0x" + t.ToString("x2");
            }
        }

        public static (List<WasmFunction> imports, List<WasmFunction> exports) Functions(byte[] wasm)
        {
            if (wasm.Length < 8 || wasm[0] != 0 || wasm[1] != (byte)'a' || wasm[2] != (byte)'s' || wasm[3] != (byte)'m')
                throw new InvalidDataException("not a wasm module");
            var types = new List<(byte[] p, byte[] r)>();
            var imports = new List<WasmFunction>();
            var functions = new List<int>(); // type index of each function, imports first
            var exports = new List<WasmFunction>();
            int i = 8;
            while (i < wasm.Length)
            {
                byte id = wasm[i++];
                int size = (int)Leb(wasm, ref i), end = i + size;
                switch (id)
                {
                    case 1:
                        for (uint n = Leb(wasm, ref i); n > 0; n--)
                        {
                            if (wasm[i++] != 0x60)
                                throw new InvalidDataException("unsupported type form at " + (i - 1));
                            var p = Types(wasm, ref i);
                            types.Add((p, Types(wasm, ref i)));
                        }
                        break;
                    case 2:
                        for (uint n = Leb(wasm, ref i); n > 0; n--)
                        {
                            var module = Name(wasm, ref i);
                            var name = Name(wasm, ref i);
                            byte kind = wasm[i++];
                            switch (kind)
                            {
                                case 0:
                                    int t = (int)Leb(wasm, ref i);
                                    functions.Add(t);
                                    imports.Add(new WasmFunction { Module = module, Name = name, Params = types[t].p, Results = types[t].r });
                                    break;
                                case 1: i++; Limits(wasm, ref i); break; // table: reftype, limits
                                case 2: Limits(wasm, ref i); break; // memory
                                case 3: i += 2; break; // global: valtype, mutability
                                case 4: i++; Leb(wasm, ref i); break; // tag
                                default: throw new InvalidDataException("unknown import kind " + kind);
                            }
                        }
                        break;
                    case 3:
                        for (uint n = Leb(wasm, ref i); n > 0; n--)
                            functions.Add((int)Leb(wasm, ref i));
                        break;
                    case 7:
                        for (uint n = Leb(wasm, ref i); n > 0; n--)
                        {
                            var name = Name(wasm, ref i);
                            byte kind = wasm[i++];
                            int index = (int)Leb(wasm, ref i);
                            if (kind == 0)
                                exports.Add(new WasmFunction { Name = name, Params = types[functions[index]].p, Results = types[functions[index]].r });
                        }
                        break;
                }
                i = end;
            }
            return (imports, exports);
        }

        static byte[] Types(byte[] wasm, ref int i)
        {
            var list = new byte[Leb(wasm, ref i)];
            for (int k = 0; k < list.Length; k++)
            {
                list[k] = wasm[i++];
                if (list[k] == 0x63 || list[k] == 0x64)
                    throw new InvalidDataException("typed references are not supported");
            }
            return list;
        }

        static void Limits(byte[] wasm, ref int i)
        {
            byte flags = wasm[i++];
            Leb(wasm, ref i);
            if ((flags & 1) != 0)
                Leb(wasm, ref i);
        }

        static string Name(byte[] wasm, ref int i)
        {
            int length = (int)Leb(wasm, ref i);
            var s = Encoding.UTF8.GetString(wasm, i, length);
            i += length;
            return s;
        }

        static uint Leb(byte[] wasm, ref int i)
        {
            uint result = 0;
            for (int shift = 0; ; shift += 7)
            {
                byte b = wasm[i++];
                result |= (uint)(b & 0x7f) << shift;
                if ((b & 0x80) == 0)
                    return result;
            }
        }
    }
}
