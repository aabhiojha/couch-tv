using System;
using System.IO;

namespace CouchTor
{
    public static class ContentTypes
    {
        static readonly string[] Video = { ".mp4", ".m4v", ".mkv", ".avi", ".ts", ".m2ts", ".webm", ".mov", ".mpg", ".mpeg", ".wmv", ".flv" };

        public static string For(string fileName)
        {
            switch ((Path.GetExtension(fileName ?? "") ?? "").ToLowerInvariant())
            {
                case ".mp4": case ".m4v": return "video/mp4";
                case ".mkv": return "video/x-matroska";
                case ".avi": return "video/x-msvideo";
                case ".ts": case ".m2ts": return "video/mp2t";
                case ".webm": return "video/webm";
                case ".mov": return "video/quicktime";
                case ".mpg": case ".mpeg": return "video/mpeg";
                case ".wmv": return "video/x-ms-wmv";
                case ".flv": return "video/x-flv";
                case ".srt": return "application/x-subrip";
                case ".vtt": return "text/vtt";
                case ".jpg": case ".jpeg": return "image/jpeg";
                case ".png": return "image/png";
                case ".iso": return "application/x-iso9660-image";
                default: return "application/octet-stream";
            }
        }

        public static bool IsVideo(string fileName)
            => Array.IndexOf(Video, (Path.GetExtension(fileName ?? "") ?? "").ToLowerInvariant()) >= 0;
    }
}
