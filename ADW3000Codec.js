/**
 * Payload Decoder
 *
 * @product ADW300
 */
// Chirpstack v4
function decodeUplink(input) {
    var decoded = milesightDeviceDecode(input.bytes);
    return { data: decoded };
}

// Chirpstack v3
function Decode(fPort, bytes) {
    return milesightDeviceDecode(bytes);
}

// The Things Network
function Decoder(bytes, port) {
    return milesightDeviceDecode(bytes);
}


/* 
 Parser function Incoming byte stream 
 return: {
    applicationID
    applicationName
    deviceName
    devEUI
    time
    mac
    snr
    data: { //parsing data

    }
 }
*/
function milesightDeviceDecode(bytes) {
    var decoded = {};
 
    for (var i = 0; i < bytes.length;) {
        // channel_id Address to be read e.g. Current of B phase channel_id is 27/0x1B.
        var channel_id = bytes[i++];

        //check if it is the last byte; if so, it does not constitute a data item, discard it.
        if (i === bytes.length) {
            break;
        }

        var val = readUInt32BE(bytes.slice(i, i + 4));
        switch (channel_id) {
            case 0x01:
                decoded.PT = val;  //PT
                i += 4;
                break;
            case 0x02:
                decoded.CT = val;  //CT
                i += 4;
                break;
            case 0x03:
                decoded.TempN = val / 10;  //Temperature of N phase
                i += 4;
                break;
            case 0x04:
                decoded.Ua = val * 0.1 *decoded.PT;  //Voltage of A phase
                i += 4;
                break;
            case 0x05:
                decoded.Ub = val * 0.1 *decoded.PT;//Voltage of b phase
                i += 4;
                break;
            case 0x06:
                decoded.Uc = val * 0.1 *decoded.PT;//Voltage of c phase
                i += 4;
                break;
            case 0x07:
                decoded.Uab = val * 0.1 *decoded.PT;//Voltage between A-B
                i += 4;
                break;
            case 0x08:
                decoded.Ubc = val * 0.1 *decoded.PT;//Voltage between B-C
                i += 4;
                break;
            case 0x09:
                decoded.Uca = val * 0.1 *decoded.PT;//Voltage between C-A
                i += 4;
                break;
            case 0x0A:
                decoded.Ia = val * 0.01 *decoded.CT;
                i += 4;
                break;
            case 0x0B:
                decoded.Ib = val * 0.01 *decoded.CT;
                i += 4;
                break;
            case 0x0C:
                decoded.Ic = val * 0.01 *decoded.CT;
                i += 4;
                break;
            case 0x0D:
                decoded.Pa = val * 0.001 *decoded.CT * decoded.PT;  //Active power of A phase
                i += 4;
                break;
            case 0x0E:
                decoded.Pb = val * 0.001 *decoded.CT * decoded.PT; //Active power of B phase
                i += 4;
                break;
            case 0x0F:
                decoded.Pc = val * 0.001 *decoded.CT * decoded.PT;//Active power of C phase
                i += 4;
                break;
            case 0x10:
                decoded.P = val * 0.001 *decoded.CT * decoded.PT;//Total active power
                i += 4;
                break;
            case 0x11:
                decoded.Qa = val * 0.001 *decoded.CT * decoded.PT;//Reactive power of A phase
                i += 4;
                break;
            case 0x12:
                decoded.Qb = val * 0.001 *decoded.CT * decoded.PT;//Reactive power of B phase
                i += 4;
                break;
            case 0x13:
                decoded.Qc = val * 0.001 *decoded.CT * decoded.PT;//Reactive power of C phase
                i += 4;
                break;
            case 0x14:
                decoded.Q = val * 0.001 *decoded.CT * decoded.PT;//Total reactive power
                i += 4;
                break;
            case 0x15:
                decoded.Sa = val * 0.001 *decoded.CT * decoded.PT;  //Apparent power of A 
                i += 4;
                break;
            case 0x16:
                decoded.Sb = val * 0.001 *decoded.CT * decoded.PT;//Apparent power of B phase
                i += 4;
                break;  
            case 0x17:
                decoded.Sc = val * 0.001 *decoded.CT * decoded.PT;//Apparent power of C phase
                i += 4;
                break;
            case 0x18:
                decoded.S = val * 0.001 *decoded.CT * decoded.PT;//Total apparent power
                i += 4;
                break;
            case 0x19:
                decoded.Pfa = val * 0.001;//Power factor of A phase
                i += 4;
                break;
            case 0x1A:
                decoded.Pfb = val * 0.001;//Power factor of B phase
                i += 4;
                break;
            case 0x1B:
                decoded.Pfc = val * 0.001;//Power factor of C phase
                i += 4;
                break;
            case 0x1C:
                decoded.Pf = val * 0.001; //Total power factor
                i += 4;
                break;
            case 0x1D:
                decoded.DI1 = bytes[i];  //DI
                decoded.DI2 = bytes[i + 1];
                decoded.DI3 = bytes[i + 2];
                decoded.DI4 = bytes[i + 3];
                i += 4;
                break;
            case 0x1E:
                decoded.EP = val * 0.01 *decoded.CT * decoded.PT;  //Total energy consumption
                i += 4;
                break;
            case 0x1F:
                decoded.EPI = val * 0.01 *decoded.CT * decoded.PT;  //Forward active energy consumption
                i += 4;
                break;
            case 0x20:
                decoded.EPE = val * 0.01 *decoded.CT * decoded.PT;   //Reversing active energy consumption
                i += 4;
                break;
            case 0x21:
                decoded.EQL = val * 0.01 *decoded.CT * decoded.PT;   //Forward reactive energy consumption
                i += 4;
                break;
            case 0x22:
                decoded.EQC = val * 0.01 *decoded.CT * decoded.PT;  //Reversing reactive energy consumption
                i += 4;
                break;
            case 0x23:
                decoded.EPa = val * 0.01 *decoded.CT * decoded.PT;// Total energy consumption on A phase
                i += 4;
                break;
            case 0x24:
                decoded.EPIa = val * 0.01 *decoded.CT * decoded.PT;//Forward active energy consumption on A phase
                i += 4;
                break;
            case 0x25:
                decoded.EPEa = val * 0.01 *decoded.CT * decoded.PT;//Reversing active energy consumption on A phase
                i += 4;
                break;
            case 0x26:
                decoded.EQLa = val * 0.01 *decoded.CT * decoded.PT;//Forward reactive energy consumption on A phase
                i += 4;
                break;
            case 0x27:
                decoded.EQCa = val * 0.01 *decoded.CT * decoded.PT;//Reversing reactive energy consumption on A phase
                i += 4;
                break;
            case 0x28:
                decoded.EPb = val * 0.01 *decoded.CT * decoded.PT;// Total energy consumption on B phase
                i += 4;
                break;
            case 0x29:
                decoded.EPIb = val * 0.01 *decoded.CT * decoded.PT;     //Forward active energy consumption on B phase
                i += 4;
                break;
            case 0x2A:
                decoded.EPEb = val * 0.01 *decoded.CT * decoded.PT;
                i += 4;
                break;
            case 0x2B:
                decoded.EQLb = val * 0.01 *decoded.CT * decoded.PT;
                i += 4;
                break;
            case 0x2C:
                decoded.EQCb = val * 0.01 *decoded.CT * decoded.PT;
                i += 4;
                break;
            case 0x2D:
                decoded.EPc = val * 0.01 *decoded.CT * decoded.PT;
                i += 4;
                break;
            case 0x2E:
                decoded.EPIc = val * 0.01 *decoded.CT * decoded.PT;
                i += 4;
                break;
            case 0x2F:
                decoded.EPEc = val * 0.01 *decoded.CT * decoded.PT;
                i += 4;
                break;
            case 0x30:
                decoded.EQLc = val * 0.01 *decoded.CT * decoded.PT;
                i += 4;
                break;
            case 0x31:
                decoded.EQCc = val * 0.01 *decoded.CT * decoded.PT;
                i += 4;
                break;
            case 0x32:
                decoded.MD = val * 0.001  *decoded.CT * decoded.PT;   //Maximum forward active demand in current month
                i += 4;
                break;
            case 0x33:
                decoded.MDTimeStamp = bytes[i + 1] + '-' + bytes[i] + ' ' + bytes[i + 3] + ':' + bytes[i + 2] //    ʱ  
                i += 4;
                break;
            case 0x34:
                decoded.UaTHD = val * 0.01;  //THDUa
                i += 4;
                break;
            case 0x35:
                decoded.UbTHD = val * 0.01;
                i += 4;
                break;
            case 0x36:
                decoded.UcTHD = val * 0.01;
                i += 4;
                break;
            case 0x37:
                decoded.IaTHD = val * 0.01;  //THDIa
                i += 4;
                break;
            case 0x38:
                decoded.IbTHD = val * 0.01;
                i += 4;
                break;
            case 0x39:
                decoded.IcTHD = val * 0.01;
                i += 4;
                break;
            case 0x3A:
                decoded.RD = val * 0.001  *decoded.CT * decoded.PT;   //Current forward active demand
                i += 4;
                break;
            case 0x3B:
                decoded.VUB = val * 0.01;   //Voltage imbalance
                i += 4;
                break;
            case 0x3C:
                decoded.CUB = val * 0.01;   //Current imbalance
                i += 4;
                break;
            case 0x3D:
                decoded.TempA = val * 0.1; //Temperature on A phase
                i += 4;
                break;
            case 0x3E:
                decoded.TempB = val * 0.1;
                i += 4;
                break;
            case 0x3F:
                decoded.TempC = val * 0.1;
                i += 4;
                break;
            case 0x40:
                decoded.EPJ = val * 0.01 *decoded.CT * decoded.PT;   //Current total spike active energy
                i += 4;
                break;
            case 0x41:
                decoded.EPF = val * 0.01 *decoded.CT * decoded.PT; //Current total peak active energy
                i += 4;
                break;
            case 0x42:
                decoded.EPP = val * 0.01 *decoded.CT * decoded.PT; //Current total flat active energy
                i += 4;
                break;
            case 0x43:
                decoded.EPG = val * 0.01 *decoded.CT * decoded.PT; //Current total valley active energy
                i += 4;
                break;
            case 0x44:
                decoded.IL = val *decoded.CT; //Aftercurrent     
                i += 4;
                break;
            default:
                i += 4;
                break;
        }

    }

    return decoded;
}

/* ******************************************
 * bytes to number
 ********************************************/
function readUInt16BE(bytes) {
    console.log('bytes', bytes);
    var value = (bytes[0] << 8) + bytes[1];
    return value & 0xffff;
}

function readInt16BE(bytes) {
    var ref = readUInt16LE(bytes);
    return ref > 0x7fff ? ref - 0x10000 : ref;
}

//Unsigned integer conversion, which should be used exclusively in the ADW300.
function readUInt32BE(bytes) {
    var value = (bytes[0] << 24) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
    return value & 0xffffffff; //To limit the result to the 32-bit range and prevent overflow
}

//Float conversion for reading IEEE 754 32-bit floating point numbers in big-endian format
function readFloatBE(bytes) {
    var bits = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
    var sign = bits >>> 31 === 0 ? 1.0 : -1.0;
    var e = (bits >>> 23) & 0xff;
    var m = e === 0 ? (bits & 0x7fffff) << 1 : (bits & 0x7fffff) | 0x800000;
    var f = sign * m * Math.pow(2, e - 150);
    return f;
}