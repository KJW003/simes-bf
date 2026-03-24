function Decode(fPort, bytes, variables) {
  var decoded = {};
  var i = 0;

  function readUInt32BE(arr) {
    var value = (arr[0] << 24) + (arr[1] << 16) + (arr[2] << 8) + arr[3];
    return value >>> 0;
  }

  function toInt32(u32) {
    return (u32 > 0x7FFFFFFF) ? (u32 - 0x100000000) : u32;
  }

  // Optionnel: CS à la fin (si dernier byte seul)
  while (i < bytes.length) {
    var channel_id = bytes[i++];

    // si dernier byte (CS) => stop
    if (i === bytes.length) break;

    if (i + 4 > bytes.length) break;

    var val = readUInt32BE(bytes.slice(i, i + 4));
    i += 4;

    switch (channel_id) {
      case 0x01: decoded.PT = val & 0xFFFF; break; // PT Uint16
      case 0x02: decoded.CT = val & 0xFFFF; break; // CT Uint16
      case 0x03: decoded.TempN = ((val & 0xFFFF) > 0x7FFF ? (val & 0xFFFF) - 0x10000 : (val & 0xFFFF)) / 10; break;

      case 0x04: decoded.Ua = val * 0.1 *decoded.PT; break;
      case 0x05: decoded.Ub = val * 0.1 *decoded.PT; break;
      case 0x06: decoded.Uc = val * 0.1 *decoded.PT; break;
      case 0x07: decoded.Uab = val * 0.1 *decoded.PT; break;
      case 0x08: decoded.Ubc = val * 0.1 *decoded.PT; break;
      case 0x09: decoded.Uca = val * 0.1 *decoded.PT; break;

      case 0x0A: decoded.Ia = val * 0.01 *decoded.CT; break;
      case 0x0B: decoded.Ib = val * 0.01 *decoded.CT; break;
      case 0x0C: decoded.Ic = val * 0.01 *decoded.CT; break;

      // Puissances = Int32 (doc)
      case 0x0D: decoded.Pa = toInt32(val) * 0.001 *decoded.CT *decoded.PT; break;
      case 0x0E: decoded.Pb = toInt32(val) * 0.001 *decoded.CT *decoded.PT; break;
      case 0x0F: decoded.Pc = toInt32(val) * 0.001 *decoded.CT *decoded.PT; break;
      case 0x10: decoded.P  = toInt32(val) * 0.001 *decoded.CT *decoded.PT; break;

      case 0x11: decoded.Qa = toInt32(val) * 0.001 *decoded.CT *decoded.PT; break;
      case 0x12: decoded.Qb = toInt32(val) * 0.001 *decoded.CT *decoded.PT; break;
      case 0x13: decoded.Qc = toInt32(val) * 0.001 *decoded.CT *decoded.PT; break;
      case 0x14: decoded.Q  = toInt32(val) * 0.001 *decoded.CT *decoded.PT; break;

      // Apparent power = Uint32
      case 0x15: decoded.Sa = val * 0.001 *decoded.CT *decoded.PT; break;
      case 0x16: decoded.Sb = val * 0.001 *decoded.CT *decoded.PT; break;
      case 0x17: decoded.Sc = val * 0.001 *decoded.CT *decoded.PT; break;
      case 0x18: decoded.S  = val * 0.001 *decoded.CT *decoded.PT; break;

      // PF = Uint16*0.001
      case 0x19: decoded.Pfa = (val & 0xFFFF) * 0.001; break;
      case 0x1A: decoded.Pfb = (val & 0xFFFF) * 0.001; break;
      case 0x1B: decoded.Pfc = (val & 0xFFFF) * 0.001; break;
      case 0x1C: decoded.Pf  = (val & 0xFFFF) * 0.001; break;

      // DI state bits (doc table)
      case 0x1D:
        var di = val & 0xFFFF;
        decoded.DI_state = di;
        decoded.DI1 = (di & 0x0001) ? 1 : 0;
        decoded.DI2 = (di & 0x0002) ? 1 : 0;
        decoded.DI3 = (di & 0x0004) ? 1 : 0;
        decoded.DI4 = (di & 0x0008) ? 1 : 0;
        break;

      // Energies (Uint32*0.01)
      case 0x1E: decoded.EP  = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x1F: decoded.EPI = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x20: decoded.EPE = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x21: decoded.EQL = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x22: decoded.EQC = val * 0.01 *decoded.CT*decoded.PT; break;

      case 0x23: decoded.EPa  = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x24: decoded.EPIa = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x25: decoded.EPEa = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x26: decoded.EQLa = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x27: decoded.EQCa = val * 0.01 *decoded.CT*decoded.PT; break;

      case 0x28: decoded.EPb  = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x29: decoded.EPIb = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x2A: decoded.EPEb = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x2B: decoded.EQLb = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x2C: decoded.EQCb = val * 0.01 *decoded.CT*decoded.PT; break;

      case 0x2D: decoded.EPc  = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x2E: decoded.EPIc = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x2F: decoded.EPEc = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x30: decoded.EQLc = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x31: decoded.EQCc = val * 0.01 *decoded.CT*decoded.PT; break;

      // Demand month + timestamp
      case 0x32: decoded.MD = val * 0.001 *decoded.CT*decoded.PT; break;
      case 0x33:
        // format du doc
        decoded.MDTimeStamp = bytes[i - 3] + '-' + bytes[i - 4] + ' ' + bytes[i - 1] + ':' + bytes[i - 2];
        break;

      // THD / imbalance / temperatures
      case 0x34: decoded.UaTHD = (val & 0xFFFF) * 0.01; break;
      case 0x35: decoded.UbTHD = (val & 0xFFFF) * 0.01; break;
      case 0x36: decoded.UcTHD = (val & 0xFFFF) * 0.01; break;
      case 0x37: decoded.IaTHD = (val & 0xFFFF) * 0.01; break;
      case 0x38: decoded.IbTHD = (val & 0xFFFF) * 0.01; break;
      case 0x39: decoded.IcTHD = (val & 0xFFFF) * 0.01; break;

      case 0x3A: decoded.RD  = val * 0.001 *decoded.CT*decoded.PT; break;
      case 0x3B: decoded.VUB = (val & 0xFFFF) * 0.01; break;
      case 0x3C: decoded.CUB = (val & 0xFFFF) * 0.01; break;

      case 0x3D: decoded.TempA = ((val & 0xFFFF) > 0x7FFF ? (val & 0xFFFF) - 0x10000 : (val & 0xFFFF)) * 0.1; break;
      case 0x3E: decoded.TempB = ((val & 0xFFFF) > 0x7FFF ? (val & 0xFFFF) - 0x10000 : (val & 0xFFFF)) * 0.1; break;
      case 0x3F: decoded.TempC = ((val & 0xFFFF) > 0x7FFF ? (val & 0xFFFF) - 0x10000 : (val & 0xFFFF)) * 0.1; break;

      // Time-of-use energies
      case 0x40: decoded.EPJ = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x41: decoded.EPF = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x42: decoded.EPP = val * 0.01 *decoded.CT*decoded.PT; break;
      case 0x43: decoded.EPG = val * 0.01 *decoded.CT*decoded.PT; break;

      // Aftercurrent (mA, Uint16)
      case 0x44: decoded.IL = (val & 0xFFFF) *decoded.CT; break;

      default:
        // ignore
        break;
    }
  }
  
  return decoded;
}