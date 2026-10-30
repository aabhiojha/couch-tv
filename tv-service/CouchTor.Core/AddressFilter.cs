using System.Net;
using System.Net.Sockets;

namespace CouchTor
{
    /// <summary>Accepts loopback and private LAN clients only (127/8, 10/8, 172.16/12, 192.168/16, ::1).</summary>
    public static class AddressFilter
    {
        public static bool IsAllowed(IPAddress address)
        {
            if (address == null)
                return false;
            if (address.AddressFamily == AddressFamily.InterNetworkV6)
            {
                if (address.Equals(IPAddress.IPv6Loopback))
                    return true;
                if (!address.IsIPv4MappedToIPv6)
                    return false;
                address = address.MapToIPv4();
            }
            if (address.AddressFamily != AddressFamily.InterNetwork)
                return false;
            var b = address.GetAddressBytes();
            return b[0] == 127
                || b[0] == 10
                || (b[0] == 172 && (b[1] & 0xF0) == 16)
                || (b[0] == 192 && b[1] == 168);
        }
    }
}
