/* JSSpeccy 2.2.1, Matt Westcott and contributors; GPL-3.0-or-later. See COPYING. */
var JSSpeccy = {traps:{}};
JSSpeccy.Display = function(opts) {
	var self = {};
	
	var viewport = opts.viewport;
	var memory = opts.memory;
	var model = opts.model || JSSpeccy.Spectrum.MODEL_128K;
	var border = opts.borderEnabled;

	var checkerboardFilterEnabled = opts.settings.checkerboardFilter.get();
	opts.settings.checkerboardFilter.onChange.bind(function(newValue) {
		checkerboardFilterEnabled = newValue;
	});
	
	var palette = new Int32Array([
		/* RGBA dark */
		0x000000ff,
		0x2030c0ff,
		0xc04010ff,
		0xc040c0ff,
		0x40b010ff,
		0x50c0b0ff,
		0xe0c010ff,
		0xc0c0c0ff,
		/* RGBA bright */
		0x000000ff,
		0x3040ffff,
		0xff4030ff,
		0xff70f0ff,
		0x50e010ff,
		0x50e0ffff,
		0xffe850ff,
		0xffffffff
	]);

	var testUint8 = new Uint8Array(new Uint16Array([0x8000]).buffer);
	var isLittleEndian = (testUint8[0] === 0);
	if(isLittleEndian) {
		/* need to reverse the byte ordering of palette */
		for(var i = 0; i < 16; i++) {
			var color = palette[i];
			palette[i] = ((color << 24) & 0xff000000) | ((color << 8) & 0xff0000) | ((color >>> 8) & 0xff00) | ((color >>> 24) & 0xff);
		}
	}


	var LEFT_BORDER_CHARS = 4;
	var RIGHT_BORDER_CHARS = 4;
	var TOP_BORDER_LINES = 24;
	var BOTTOM_BORDER_LINES = 24;
	var TSTATES_PER_CHAR = 4;
	
	var TSTATES_UNTIL_ORIGIN = model.tstatesUntilOrigin;
	var TSTATES_PER_SCANLINE = model.tstatesPerScanline;
	self.frameLength = model.frameLength;
	
	var BEAM_X_MAX = 32 + (border ? RIGHT_BORDER_CHARS : 0);
	var BEAM_Y_MAX = 192 + (border ? BOTTOM_BORDER_LINES : 0);
	
	var CANVAS_WIDTH = 256 + (border ? ((LEFT_BORDER_CHARS + RIGHT_BORDER_CHARS) * 8) : 0);
	var CANVAS_HEIGHT = 192 + (border ? (TOP_BORDER_LINES + BOTTOM_BORDER_LINES) : 0);
	
	viewport.setResolution(CANVAS_WIDTH, CANVAS_HEIGHT);
	var ctx = viewport.canvas.getContext('2d');
	var imageData = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
	var pixels = new Int32Array(imageData.data.buffer);

	/* for post-processing */
	var imageData2 = ctx.createImageData(imageData);
	var pixels2 = new Int32Array(imageData2.data.buffer);
	
	var borderColour = 7;
	self.setBorder = function(val) {
		borderColour = val;
	};
	
	var beamX, beamY; /* X character pos and Y pixel pos of beam at next screen event,
		relative to top left of non-border screen; negative / overlarge values are in the border */
	
	var pixelLineAddress; /* Address (relative to start of memory page) of the first screen byte in the current line */
	var attributeLineAddress; /* Address (relative to start of memory page) of the first attribute byte in the current line */
	var imageDataPos; /* offset into imageData buffer of current draw position */
	var currentLineStartTime;
	
	var flashPhase = 0;
  var cachePixels = !border && opts.cachePixels !== false;
  var cellCache = new Int32Array(6144);
  for (var cacheIndex=0;cacheIndex<6144;cacheIndex++)cellCache[cacheIndex]=-1;
	
	self.startFrame = function() {
		self.nextEventTime = currentLineStartTime = TSTATES_UNTIL_ORIGIN - (TOP_BORDER_LINES * TSTATES_PER_SCANLINE) - (LEFT_BORDER_CHARS * TSTATES_PER_CHAR);
		beamX = (border ? -LEFT_BORDER_CHARS : 0);
		beamY = (border ? -TOP_BORDER_LINES : 0);
		pixelLineAddress = 0x0000;
		attributeLineAddress = 0x1800;
		imageDataPos = 0;
		flashPhase = (flashPhase + 1) & 0x1f; /* FLASH has a period of 32 frames (16 on, 16 off) */
	};
	
	self.doEvent = function() {
		if (beamY < 0 | beamY >= 192 | beamX < 0 | beamX >= 32) {
			/* border */
			var color = palette[borderColour];
			pixels[imageDataPos++] = color;
			pixels[imageDataPos++] = color;
			pixels[imageDataPos++] = color;
			pixels[imageDataPos++] = color;
			pixels[imageDataPos++] = color;
			pixels[imageDataPos++] = color;
			pixels[imageDataPos++] = color;
			pixels[imageDataPos++] = color;
		} else {
			/* main screen area */
			var pixelByte = memory.readScreen( pixelLineAddress | beamX );
			var attributeByte = memory.readScreen( attributeLineAddress | beamX );
			
			var cellIndex = imageDataPos >> 3;
      var cellKey = pixelByte | (attributeByte << 8) | (((attributeByte & 128) && (flashPhase & 16)) ? 65536 : 0);
      if (cachePixels && cellCache[cellIndex] === cellKey) {
        imageDataPos += 8;
      } else {
      if (cachePixels) cellCache[cellIndex] = cellKey;
      var inkColor, paperColor;
			if ( (attributeByte & 0x80) && (flashPhase & 0x10) ) {
				/* FLASH: invert ink / paper */
				inkColor = palette[(attributeByte & 0x78) >> 3];
				paperColor = palette[(attributeByte & 0x07) | ((attributeByte & 0x40) >> 3)];
			} else {
				inkColor = palette[(attributeByte & 0x07) | ((attributeByte & 0x40) >> 3)];
				paperColor = palette[(attributeByte & 0x78) >> 3];
			}
			
			pixels[imageDataPos++] = (pixelByte & 0x80) ? inkColor : paperColor;
			pixels[imageDataPos++] = (pixelByte & 0x40) ? inkColor : paperColor;
			pixels[imageDataPos++] = (pixelByte & 0x20) ? inkColor : paperColor;
			pixels[imageDataPos++] = (pixelByte & 0x10) ? inkColor : paperColor;
			pixels[imageDataPos++] = (pixelByte & 0x08) ? inkColor : paperColor;
			pixels[imageDataPos++] = (pixelByte & 0x04) ? inkColor : paperColor;
			pixels[imageDataPos++] = (pixelByte & 0x02) ? inkColor : paperColor;
			pixels[imageDataPos++] = (pixelByte & 0x01) ? inkColor : paperColor;
      }
		}
		
		/* increment beam / nextEventTime for next event */
		beamX++;
		if (beamX < BEAM_X_MAX) {
			self.nextEventTime += TSTATES_PER_CHAR;
		} else {
			beamX = (border ? -LEFT_BORDER_CHARS : 0);
			beamY++;
			
			if (beamY >= 0 && beamY < 192) {
				/* pixel address = 0 0 0 y7 y6 y2 y1 y0 | y5 y4 y3 x4 x3 x2 x1 x0 */
				pixelLineAddress = ( (beamY & 0xc0) << 5 ) | ( (beamY & 0x07) << 8 ) | ( (beamY & 0x38) << 2 );
				/* attribute address = 0 0 0 1 1 0 y7 y6 | y5 y4 y3 x4 x3 x2 x1 x0 */
				attributeLineAddress = 0x1800 | ( (beamY & 0xf8) << 2 );
			}
			
			if (beamY < BEAM_Y_MAX) {
				currentLineStartTime += TSTATES_PER_SCANLINE;
				self.nextEventTime = currentLineStartTime;
			} else {
				self.nextEventTime = null;
			}
		}
	};
	
	self.endFrame = function() {
		if (checkerboardFilterEnabled) {
			self.postProcess();
		} else {
			ctx.putImageData(imageData, 0, 0);
		}
	};

	self.drawFullScreen = function() {
		self.startFrame();
		while (self.nextEventTime) self.doEvent();
		self.endFrame();
	};

	self.postProcess = function() {
		var pix = pixels;
		pixels2.set(pix);
		var ofs = border ? (TOP_BORDER_LINES * CANVAS_WIDTH) + (LEFT_BORDER_CHARS << 3) : 0;
		var skip = border ? ((LEFT_BORDER_CHARS + RIGHT_BORDER_CHARS) << 3) : 0;
		var width = CANVAS_WIDTH;
		var x = 0, y = 1; /* 1-pixel top/bottom margin */
		var k0 = 0, k1 = 0, k2 = 0, k3 = 0, k4 = 0, k5 = 0, k6 = 0, k7 = 0, k8 = 0;
		var avg0, avg1, avg2;
		while (y++ < 191) {
			while (x++ < 256) {
				k0 = pix[ofs - 1]; k1 = pix[ofs]; k2 = pix[ofs + 1]; ofs += width;
				k3 = pix[ofs - 1]; k4 = pix[ofs]; k5 = pix[ofs + 1]; ofs += width;
				k6 = pix[ofs - 1]; k7 = pix[ofs]; k8 = pix[ofs + 1];
				
				var mixed = ((k4 !== k1 || k4 !== k7) && (k4 !== k3 || k4 !== k5));
				
				if (k4 === k0 && k4 === k2 && k4 !== k1 && k4 !== k3 && k4 !== k5) {
					pixels2[ofs - width] = (((k4 ^ k3) & 0xfefefefe) >> 1) + (k4 & k3);
				}
				else if (k4 === k6 && k4 === k8 && k4 !== k3 && k4 !== k5 && k4 !== k7) {
					pixels2[ofs - width] = (((k4 ^ k3) & 0xfefefefe) >> 1) + (k4 & k3);
				}
				else if (k4 === k0 && k4 === k6 && k4 !== k1 && k4 !== k3 && k4 !== k7) {
					pixels2[ofs - width] = (((k4 ^ k1) & 0xfefefefe) >> 1) + (k4 & k1);
				}
				else if (k4 === k2 && k4 === k8 && k4 !== k1 && k4 !== k5 && k4 !== k7) {
					pixels2[ofs - width] = (((k4 ^ k1) & 0xfefefefe) >> 1) + (k4 & k1);
				}
				else if (mixed) {
					avg0 = (((k3 ^ k5) & 0xfefefefe) >> 1) + (k3 & k5);
					avg1 = (((k1 ^ k7) & 0xfefefefe) >> 1) + (k1 & k7);
					avg2 = (((avg0 ^ avg1) & 0xfefefefe) >> 1) + (avg0 & avg1);
					avg2 = (((k4 ^ avg2) & 0xfefefefe) >> 1) + (k4 & avg2);
					pixels2[ofs - width] = (((k4 ^ avg2) & 0xfefefefe) >> 1) + (k4 & avg2);
				}
				ofs -= (width + width - 1);
			}
			ofs += skip;
			x = 0;
		}
		ctx.putImageData(imageData2, 0, 0);
	};

	return self;
};

JSSpeccy.IOBus = function(opts) {
	var self = {};
	
	var keyboard = opts.keyboard;
	var display = opts.display;
	var memory = opts.memory;
	var sound = opts.sound;
	var contentionTable = opts.contentionTable;
	var contentionTableLength = contentionTable.length;
	
	self.read = function(addr) {
		if ((addr & 0x0001) === 0x0000) {
			return keyboard.poll(addr);
		} else if ((addr & 0xc002) == 0xc000) {
			/* AY chip */
			return sound.readSoundRegister();
		} else if ((addr & 0x00e0) === 0x0000) {
			/* kempston joystick */
			return 0;
		} else {
			return 0xff;
		}
	};
	self.write = function(addr, val, tstates) {
		if (!(addr & 0x01)) {
			display.setBorder(val & 0x07);

			sound.updateBuzzer((val & 16) >> 4, tstates);
		}
		if (!(addr & 0x8002)) {
			memory.setPaging(val);
		}
		
		if ((addr & 0xc002) == 0xc000) {
			/* AY chip - register select */
			sound.selectSoundRegister( val & 0xF );
		}
		
		if ((addr & 0xc002) == 0x8000) {
			/* AY chip - data write */
			sound.writeSoundRegister(val, tstates);
		}
		
	};

	self.isULAPort = function(addr) {
		return ((addr & 0x0001) === 0x0000);
	};
	self.contend = function(addr, tstates) {
		return contentionTable[tstates % contentionTableLength];
	};

	return self;
};

JSSpeccy.Memory = function(opts) {
	var self = {};
	var model = opts.model || JSSpeccy.Spectrum.MODEL_128K;

	var contentionTableLength = model.frameLength;

	var noContentionTable = model.noContentionTable;
	var contentionTable = model.contentionTable;

	function MemoryPage(data, isContended) {
		var self = {};
		self.memory = (data || new Uint8Array(0x4000));
		self.contentionTable = (isContended ? contentionTable : noContentionTable);
		return self;
	}
	
	var ramPages = [];
	for (var i = 0; i < 8; i++) {
		ramPages[i] = MemoryPage(null, i & 0x01); /* for MODEL_128K (and implicitly 48K), odd pages are contended */
	}

	var romPages = {
		'48.rom': MemoryPage(JSSpeccy.roms['48.rom']),
		'128-0.rom': MemoryPage(JSSpeccy.roms['128-0.rom']),
		'128-1.rom': MemoryPage(JSSpeccy.roms['128-1.rom'])
	};

	var scratch = MemoryPage();
	
	var readSlots = [
		model === JSSpeccy.Spectrum.MODEL_48K ? romPages['48.rom'].memory : romPages['128-0.rom'].memory,
		ramPages[5].memory,
		ramPages[2].memory,
		ramPages[0].memory
	];

	var writeSlots = [
		scratch.memory,
		ramPages[5].memory,
		ramPages[2].memory,
		ramPages[0].memory
	];

	var contentionBySlot = [
		noContentionTable,
		contentionTable,
		noContentionTable,
		noContentionTable
	];

	self.isContended = function(addr) {
		return (contentionBySlot[addr >> 14] == contentionTable);
	};

	self.contend = function(addr, tstate) {
		return contentionBySlot[addr >> 14][tstate % contentionTableLength];
	};

	self.read = function(addr) {
		var page = readSlots[addr >> 14];
		return page[addr & 0x3fff];
	};
	self.write = function(addr, val) {
		var page = writeSlots[addr >> 14];
		page[addr & 0x3fff] = val;
	};
	
	var screenPage = ramPages[5].memory;
	self.readScreen = function(addr) {
		return screenPage[addr];
	};

	var pagingIsLocked = false;
	if (model === JSSpeccy.Spectrum.MODEL_128K) {
		self.setPaging = function(val) {
			if (pagingIsLocked) return;
			var highMemoryPage = ramPages[val & 0x07];
			readSlots[3] = writeSlots[3] = highMemoryPage.memory;
			contentionBySlot[3] = highMemoryPage.contentionTable;
			readSlots[0] = (val & 0x10) ? romPages['128-1.rom'].memory : romPages['128-0.rom'].memory;
			screenPage = (val & 0x08) ? ramPages[7].memory : ramPages[5].memory;
			pagingIsLocked = val & 0x20;
		};
	} else {
		self.setPaging = function(val) {
		};
	}
	
	self.loadFromSnapshot = function(snapshotPages) {
		for (var p in snapshotPages) {
			var ramPage = ramPages[p].memory;
			var snapshotPage = snapshotPages[p];
			for (var i = 0; i < 0x4000; i++) {
				ramPage[i] = snapshotPage[i];
			}
		}
	};

	self.reset = function() {
		pagingIsLocked = false;
		self.setPaging(0);
	};

	return self;
};

JSSpeccy.SnaFile = function(data) {
	var mode128 = false, snapshot = null, len = data.byteLength, sna;

	switch (len) {
		case 131103:
		case 147487:
			mode128 = true;
		case 49179:
			sna = new DataView(data, 0, mode128 ? 49182 : len);
			snapshot = {
				model: (mode128
					? JSSpeccy.Spectrum.MODEL_128K
					: JSSpeccy.Spectrum.MODEL_48K),
				registers: {},
				ulaState: {},
			/* construct byte arrays of length 0x4000 at the appropriate offsets into the data stream */
				memoryPages: {
					5: new Uint8Array(data, 0x0000 + 27, 0x4000),
					2: new Uint8Array(data, 0x4000 + 27, 0x4000)
				}
			};

			if (mode128) {
				var page = (sna.getUint8(49181) & 7);
				snapshot.memoryPages[page] = new Uint8Array(data, 0x8000 + 27, 0x4000);

				for (var i = 0, ptr = 49183; i < 8; i++) {
					if (typeof snapshot.memoryPages[i] === 'undefined') {
						snapshot.memoryPages[i] = new Uint8Array(data, ptr, 0x4000);
						ptr += 0x4000;
					}
				}
			}
			else
				snapshot.memoryPages[0] = new Uint8Array(data, 0x8000 + 27, 0x4000);

			snapshot.registers['IR'] = (sna.getUint8(0) << 8) | sna.getUint8(20);
			snapshot.registers['HL_'] = sna.getUint16(1, true);
			snapshot.registers['DE_'] = sna.getUint16(3, true);
			snapshot.registers['BC_'] = sna.getUint16(5, true);
			snapshot.registers['AF_'] = sna.getUint16(7, true);
			snapshot.registers['HL'] = sna.getUint16(9, true);
			snapshot.registers['DE'] = sna.getUint16(11, true);
			snapshot.registers['BC'] = sna.getUint16(13, true);
			snapshot.registers['IY'] = sna.getUint16(15, true);
			snapshot.registers['IX'] = sna.getUint16(17, true);
			snapshot.registers['iff1'] = snapshot.registers['iff2'] = (sna.getUint8(19) & 0x04) >> 2;
			snapshot.registers['AF'] = sna.getUint16(21, true);

			if (mode128) {
				snapshot.registers['SP'] = sna.getUint16(23, true);
				snapshot.registers['PC'] = sna.getUint16(49179, true);
				snapshot.ulaState.pagingFlags = sna.getUint8(49181);
			}
			else {
				/* peek memory at SP to get proper value of PC */
				var sp = sna.getUint16(23, true);
				var l = sna.getUint8(sp - 16384 + 27);
				sp = (sp + 1) & 0xffff;
				var h = sna.getUint8(sp - 16384 + 27);
				sp = (sp + 1) & 0xffff;
				snapshot.registers['PC'] = (h << 8) | l;
				snapshot.registers['SP'] = sp;
			}

			snapshot.registers['im'] = sna.getUint8(25);
			snapshot.ulaState.borderColour = sna.getUint8(26);
			break;

		default:
			throw "Cannot handle SNA snapshots of length " + len;
	}

	return snapshot;
}

JSSpeccy.Spectrum = function(opts) {
	var self = {};

	model = opts.model || JSSpeccy.Spectrum.MODEL_128K;

	var viewport = opts.viewport;
	var keyboard = opts.keyboard;
	var controller = opts.controller;
	var soundBackend = opts.soundBackend;

	var memory = JSSpeccy.Memory({
		model: model
	});

	var display = JSSpeccy.Display({
		viewport: viewport,
		memory: memory,
		model: model,
		borderEnabled: opts.borderEnabled,
		settings: {
			'checkerboardFilter': controller.settings.checkerboardFilter
		}
	});

	var sound = JSSpeccy.SoundGenerator({
		model: model,
		soundBackend: soundBackend
	});

	var ioBus = JSSpeccy.IOBus({
		keyboard: keyboard,
		display: display,
		memory: memory,
		sound: sound,
		contentionTable: model.contentionTable
	});

	var processor = JSSpeccy.Z80({
		memory: memory,
		ioBus: ioBus,
		display: display
	});

	/* internal state to allow picking up mid-frame (e.g. when loading from a snapshot) */
	var startNextFrameWithInterrupt = true;

	self.runFrame = function() {
		display.startFrame();
		if (startNextFrameWithInterrupt) {
			processor.requestInterrupt();
		}
		processor.runFrame(model.frameLength);
		display.endFrame();
		sound.endFrame();
		processor.setTstates(processor.getTstates() - model.frameLength);
		startNextFrameWithInterrupt = true;
	};
	self.reset = function() {
		processor.reset();
		memory.reset();
		sound.reset();
	};

	self.loadSnapshot = function(snapshot) {
		memory.loadFromSnapshot(snapshot.memoryPages);
		if ('pagingFlags' in snapshot.ulaState) {
			memory.setPaging(snapshot.ulaState.pagingFlags);
		}
		processor.loadFromSnapshot(snapshot.registers);
		display.setBorder(snapshot.ulaState.borderColour);
		if ('tstates' in snapshot) {
			processor.setTstates(snapshot.tstates);
			startNextFrameWithInterrupt = false;
		}
	};

	self.drawFullScreen = function() {
		display.drawFullScreen();
	};

	JSSpeccy.traps.tapeLoad = function() {
		if (!controller.currentTape) return true; /* no current tape, so return from trap;
			resume the trapped instruction */
		var block = controller.currentTape.getNextLoadableBlock();
		if (!block) return true; /* no loadable blocks on tape, so return from trap */

		var success = true;

		var expectedBlockType = processor.getA_();
		var startAddress = processor.getIX();
		var requestedLength = processor.getDE();

		var actualBlockType = block[0];
		if (expectedBlockType != actualBlockType) {
			success = false;
		} else {
			/* block type is the one we're looking for */
			if (processor.getCarry_()) {
				/* perform a LOAD */
				var offset = 0;
				var checksum = actualBlockType;

				while (offset < requestedLength) {
					var loadedByte = block[offset+1];
					if (typeof(loadedByte) == 'undefined') {
						/* have run out of bytes to load - indicate error */
						success = false;
						break;
					}
					memory.write((startAddress + offset) & 0xffff, loadedByte);
					checksum ^= loadedByte;
					offset++;
				}

				/* if the full quota of bytes has been loaded, compare checksums now */
				var expectedChecksum = block[offset+1];
				success = (checksum === expectedChecksum);
			} else {
				/* perform a VERIFY */
				success = true; /* for now, just report success. TODO: do VERIFY properly... */
			}
		}

		processor.setCarry(success); /* set or reset carry flag to indicate success or failure respectively */
		processor.setPC(0x05e2); /* address at which to exit tape trap */
		return false; /* cancel execution of the opcode where this trap happened */
	};

	return self;
};


JSSpeccy.buildContentionTables = function(model) {
	function buildTable(pattern) {
		var table = new Uint8Array(model.frameLength);
		for (var line = 0; line < 192; line++) {
			var lineStartTime = model.tstatesUntilOrigin + (line * model.tstatesPerScanline);
			for (var x = 0; x < 128; x++) {
				table[lineStartTime + x] = pattern[x % 8];
			}
		}
		return table;
	}

	model.contentionTable = buildTable(model.contentionPattern);
	model.noContentionTable = buildTable([0,0,0,0,0,0,0,0]);
};

JSSpeccy.Spectrum.MODEL_48K = {
	id: '48k',
	name: 'Spectrum 48K',
	tapeAutoloader: 'tape_48.z80',
	tstatesUntilOrigin: 14336,
	tstatesPerScanline: 224,
	frameLength: 69888,
	clockSpeed: 3500000,
	contentionPattern: [6,5,4,3,2,1,0,0]
};
JSSpeccy.buildContentionTables(JSSpeccy.Spectrum.MODEL_48K);

JSSpeccy.Spectrum.MODEL_128K = {
	id: '128k',
	name: 'Spectrum 128K',
	tapeAutoloader: 'tape_128.z80',
	tstatesUntilOrigin: 14362,
	tstatesPerScanline: 228,
	frameLength: 70908,
	clockSpeed: 3546900,
	contentionPattern: [6,5,4,3,2,1,0,0]
};
JSSpeccy.buildContentionTables(JSSpeccy.Spectrum.MODEL_128K);

JSSpeccy.Spectrum.MODELS = [
	JSSpeccy.Spectrum.MODEL_48K,
	JSSpeccy.Spectrum.MODEL_128K
];

window.JSSpeccy.Z80 = function(opts) {
	var self = {};

	var memory = opts.memory;
var ioBus = opts.ioBus;
var display = opts.display;

var registerBuffer = new ArrayBuffer(26);
/* Expose registerBuffer as both register pairs and individual registers */
var regPairs = new Uint16Array(registerBuffer);
var regs = new Uint8Array(registerBuffer);

var tstates = 0; /* number of tstates since start of this frame */
var iff1 = 0;
var iff2 = 0;
var im = 0;
var halted = false;

/* tables for setting Z80 flags */

/*
	Whether a half carry occurred or not can be determined by looking at
	the 3rd bit of the two arguments and the result; these are hashed
	into this table in the form r12, where r is the 3rd bit of the
	result, 1 is the 3rd bit of the 1st argument and 2 is the
	third bit of the 2nd argument; the tables differ for add and subtract
	operations
*/
var halfcarryAddTable = new Uint8Array([0, 16, 16, 16, 0, 0, 0, 16]);
var halfcarrySubTable = new Uint8Array([0, 0, 16, 0, 16, 0, 16, 16]);

/*
	Similarly, overflow can be determined by looking at the 7th bits; again
	the hash into this table is r12
*/
var overflowAddTable = new Uint8Array([0, 0, 0, 4, 4, 0, 0, 0]);
var overflowSubTable = new Uint8Array([0, 4, 0, 0, 0, 0, 4, 0]);

var sz53Table = new Uint8Array(0x100); /* The S, Z, 5 and 3 bits of the index */
var parityTable = new Uint8Array(0x100); /* The parity of the lookup value */
var sz53pTable = new Uint8Array(0x100); /* OR the above two tables together */

for (var i = 0; i < 0x100; i++) {
	sz53Table[i] = i & ( 168 );
	var j = i;
	var parity = 0;
	for (var k = 0; k < 8; k++) {
		parity ^= j & 1;
		j >>=1;
	}

	parityTable[i] = (parity ? 0 : 4);
	sz53pTable[i] = sz53Table[i] | parityTable[i];
	
	sz53Table[0] |= 64;
	sz53pTable[0] |= 64;
}

var interruptible = true;
var interruptPending = false;
var opcodePrefix = '';

	self.requestInterrupt = function() {
		interruptPending = true;
		/* TODO: use event scheduling to keep the interrupt line active for a fixed
		~48T window, to support retriggered interrupts and interrupt blocking via
		chains of EI or DD/FD prefixes */
	}
	var z80Interrupt = function() {
		if (iff1) {
			if (halted) {
				/* move PC on from the HALT opcode */
				regPairs[12]++;
				halted = false;
			}

			iff1 = iff2 = 0;

			/* push current PC in readiness for call to interrupt handler */
			regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
			regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
			
			/* TODO: R register */
			
			switch (im) {
				case 0:
					regPairs[12] = 0x0038;
					tstates += 6;
					break;
				case 1:
					regPairs[12] = 0x0038;
					tstates += 7;
					break;
				case 2:
					inttemp = (regs[21] << 8) | 0xff;
					l = ((tstates += memory.contend(inttemp, tstates) + ( 3)), memory.read(inttemp));
					inttemp = (inttemp+1) & 0xffff;
					h = ((tstates += memory.contend(inttemp, tstates) + ( 3)), memory.read(inttemp));
					regPairs[12] = (h<<8) | l;
					tstates += 7;
					break;
			}
		}
	};

	self.runFrame = function(frameLength) {
		var lastOpcodePrefix, offset, opcode;

		while (tstates < frameLength || opcodePrefix) {
			if (interruptible && interruptPending) {
				z80Interrupt();
				interruptPending = false;
			}
			interruptible = true; /* unless overridden by opcode */
			lastOpcodePrefix = opcodePrefix;
			opcodePrefix = '';
			switch (lastOpcodePrefix) {
				case '':
					(tstates += memory.contend(regPairs[12], tstates) + ( 4));
					opcode = memory.read(regPairs[12]); regPairs[12]++;
					regs[20] = ((regs[20] + 1) & 0x7f) | (regs[20] & 0x80);
					switch (opcode) {
	case 0:
	
			
	break;case 1:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
regPairs[1] = (h<<8) | l;
	break;case 2:
	
	(tstates += memory.contend(regPairs[1], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[1], regs[1]);;
	break;case 3:
	
	regPairs[1]++;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 4:
	
	

regs[0] = (regs[0] & 1) | (regs[3] & 0x0f ? 0 : 16) | 2;
regs[3] = (regs[3] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[3] == 0x80 ? 4 : 0 ) | ( regs[3] & 0x0f ? 0 : 16 ) | sz53Table[regs[3]];
	break;case 5:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[3] & 0x0f ? 0 : 16 ) | 2;
regs[3] = (regs[3] - 1) ;


regs[0] |= (regs[3] == 0x7f ? 4 : 0) | sz53Table[regs[3]];
	break;case 6:
	
	regs[3] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 7:
	
	regs[1] = (regs[1] << 1) | (regs[1] >> 7);
regs[0] = (regs[0] & 196) | (regs[1] & 41);
	break;case 8:
	
	var temp = regPairs[0];
regPairs[0] = regPairs[4];
regPairs[4] = temp;
	break;case 9:
	
	var add16temp = regPairs[3] + regPairs[1];
var lookup = ( (regPairs[3] & 0x0800) >> 11 ) | ( (regPairs[1] & 0x0800) >> 10 ) | ( (add16temp & 0x0800) >>  9 );
regPairs[3] = add16temp;
regs[0] = ( regs[0] & ( 196 ) ) | ( add16temp & 0x10000 ? 1 : 0 ) | ( ( add16temp >> 8 ) & ( 40 ) ) | halfcarryAddTable[lookup];
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 10:
	
	regs[1] = ((tstates += memory.contend(regPairs[1], tstates) + ( 3)), memory.read(regPairs[1]));
	break;case 11:
	
	regPairs[1]--;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 12:
	
	

regs[0] = (regs[0] & 1) | (regs[2] & 0x0f ? 0 : 16) | 2;
regs[2] = (regs[2] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[2] == 0x80 ? 4 : 0 ) | ( regs[2] & 0x0f ? 0 : 16 ) | sz53Table[regs[2]];
	break;case 13:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[2] & 0x0f ? 0 : 16 ) | 2;
regs[2] = (regs[2] - 1) ;


regs[0] |= (regs[2] == 0x7f ? 4 : 0) | sz53Table[regs[2]];
	break;case 14:
	
	regs[2] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 15:
	
	regs[0] = (regs[0] & 196) | (regs[1] & 1);
regs[1] = (regs[1] >> 1) | (regs[1] << 7);
regs[0] |= (regs[1] & 40);
	break;case 16:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regs[3]--;
if (regs[3]) {
	/* take branch */
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[12] += (offset & 0x80 ? offset - 0x100 : offset);
} else {
	/* do not take branch */
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 17:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
regPairs[2] = (h<<8) | l;
	break;case 18:
	
	(tstates += memory.contend(regPairs[2], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[2], regs[1]);;
	break;case 19:
	
	regPairs[2]++;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 20:
	
	

regs[0] = (regs[0] & 1) | (regs[5] & 0x0f ? 0 : 16) | 2;
regs[5] = (regs[5] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[5] == 0x80 ? 4 : 0 ) | ( regs[5] & 0x0f ? 0 : 16 ) | sz53Table[regs[5]];
	break;case 21:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[5] & 0x0f ? 0 : 16 ) | 2;
regs[5] = (regs[5] - 1) ;


regs[0] |= (regs[5] == 0x7f ? 4 : 0) | sz53Table[regs[5]];
	break;case 22:
	
	regs[5] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 23:
	
	var bytetemp = regs[1];
regs[1] = (regs[1] << 1) | (regs[0] & 1);
regs[0] = (regs[0] & 196) | (regs[1] & 40) | (bytetemp >> 7);
	break;case 24:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
regPairs[12] += (offset & 0x80 ? offset - 0x100 : offset);
	break;case 25:
	
	var add16temp = regPairs[3] + regPairs[2];
var lookup = ( (regPairs[3] & 0x0800) >> 11 ) | ( (regPairs[2] & 0x0800) >> 10 ) | ( (add16temp & 0x0800) >>  9 );
regPairs[3] = add16temp;
regs[0] = ( regs[0] & ( 196 ) ) | ( add16temp & 0x10000 ? 1 : 0 ) | ( ( add16temp >> 8 ) & ( 40 ) ) | halfcarryAddTable[lookup];
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 26:
	
	regs[1] = ((tstates += memory.contend(regPairs[2], tstates) + ( 3)), memory.read(regPairs[2]));
	break;case 27:
	
	regPairs[2]--;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 28:
	
	

regs[0] = (regs[0] & 1) | (regs[4] & 0x0f ? 0 : 16) | 2;
regs[4] = (regs[4] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[4] == 0x80 ? 4 : 0 ) | ( regs[4] & 0x0f ? 0 : 16 ) | sz53Table[regs[4]];
	break;case 29:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[4] & 0x0f ? 0 : 16 ) | 2;
regs[4] = (regs[4] - 1) ;


regs[0] |= (regs[4] == 0x7f ? 4 : 0) | sz53Table[regs[4]];
	break;case 30:
	
	regs[4] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 31:
	
	var bytetemp = regs[1];
regs[1] = (bytetemp >> 1) | (regs[0] << 7);
regs[0] = (regs[0] & 196) | (regs[1] & 40) | (bytetemp & 1);
	break;case 32:
	
	if (!(regs[0] & 64)) {
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[12] += (offset & 0x80 ? offset - 0x100 : offset);
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++; /* skip past offset byte */
}
	break;case 33:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
regPairs[3] = (h<<8) | l;
	break;case 34:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regPairs[3] & 0xff);;
addr = (addr + 1) & 0xffff;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regPairs[3] >> 8);;
	break;case 35:
	
	regPairs[3]++;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 36:
	
	

regs[0] = (regs[0] & 1) | (regs[7] & 0x0f ? 0 : 16) | 2;
regs[7] = (regs[7] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[7] == 0x80 ? 4 : 0 ) | ( regs[7] & 0x0f ? 0 : 16 ) | sz53Table[regs[7]];
	break;case 37:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[7] & 0x0f ? 0 : 16 ) | 2;
regs[7] = (regs[7] - 1) ;


regs[0] |= (regs[7] == 0x7f ? 4 : 0) | sz53Table[regs[7]];
	break;case 38:
	
	regs[7] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 39:
	
	var add = 0;
var carry = regs[0] & 1;
if( ( regs[0] & 16 ) || ( ( regs[1] & 0x0f ) > 9 ) ) add = 6;
if( carry || ( regs[1] > 0x99 ) ) add |= 0x60;
if( regs[1] > 0x99 ) carry = 1;
if( regs[0] & 2 ) {
	
var subtemp = regs[1] - add;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (add & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
} else {
	

var addtemp = regs[1] + add;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (add & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
}
regs[0] = ( regs[0] & -6 ) | carry | parityTable[regs[1]];
	break;case 40:
	
	if (regs[0] & 64) {
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[12] += (offset & 0x80 ? offset - 0x100 : offset);
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++; /* skip past offset byte */
}
	break;case 41:
	
	var add16temp = regPairs[3] + regPairs[3];
var lookup = ( (regPairs[3] & 0x0800) >> 11 ) | ( (regPairs[3] & 0x0800) >> 10 ) | ( (add16temp & 0x0800) >>  9 );
regPairs[3] = add16temp;
regs[0] = ( regs[0] & ( 196 ) ) | ( add16temp & 0x10000 ? 1 : 0 ) | ( ( add16temp >> 8 ) & ( 40 ) ) | halfcarryAddTable[lookup];
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 42:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
l = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
addr = (addr + 1) & 0xffff;
h = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regPairs[3] = (h<<8) | l;
	break;case 43:
	
	regPairs[3]--;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 44:
	
	

regs[0] = (regs[0] & 1) | (regs[6] & 0x0f ? 0 : 16) | 2;
regs[6] = (regs[6] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[6] == 0x80 ? 4 : 0 ) | ( regs[6] & 0x0f ? 0 : 16 ) | sz53Table[regs[6]];
	break;case 45:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[6] & 0x0f ? 0 : 16 ) | 2;
regs[6] = (regs[6] - 1) ;


regs[0] |= (regs[6] == 0x7f ? 4 : 0) | sz53Table[regs[6]];
	break;case 46:
	
	regs[6] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 47:
	
	regs[1] ^= 0xff;
regs[0] = (regs[0] & 197) | (regs[1] & 40) | 18;
	break;case 48:
	
	if (!(regs[0] & 1)) {
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[12] += (offset & 0x80 ? offset - 0x100 : offset);
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++; /* skip past offset byte */
}
	break;case 49:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
regPairs[11] = (h<<8) | l;
	break;case 50:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 51:
	
	regPairs[11]++;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 52:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));

regs[0] = (regs[0] & 1) | (val & 0x0f ? 0 : 16) | 2;
val = (val + 1) & 0xff;

(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
regs[0] = (regs[0] & 1) | ( val == 0x80 ? 4 : 0 ) | ( val & 0x0f ? 0 : 16 ) | sz53Table[val];
	break;case 53:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));

regs[0] = (regs[0] & 1 ) | ( val & 0x0f ? 0 : 16 ) | 2;
val = (val - 1) & 0xff;

(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
regs[0] |= (val == 0x7f ? 4 : 0) | sz53Table[val];
	break;case 54:
	
	var n = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], n);;
	break;case 55:
	
	regs[0] = (regs[0] & 196) | (regs[1] & 40) | 1;
	break;case 56:
	
	if (regs[0] & 1) {
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[12] += (offset & 0x80 ? offset - 0x100 : offset);
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++; /* skip past offset byte */
}
	break;case 57:
	
	var add16temp = regPairs[3] + regPairs[11];
var lookup = ( (regPairs[3] & 0x0800) >> 11 ) | ( (regPairs[11] & 0x0800) >> 10 ) | ( (add16temp & 0x0800) >>  9 );
regPairs[3] = add16temp;
regs[0] = ( regs[0] & ( 196 ) ) | ( add16temp & 0x10000 ? 1 : 0 ) | ( ( add16temp >> 8 ) & ( 40 ) ) | halfcarryAddTable[lookup];
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 58:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
	break;case 59:
	
	regPairs[11]--;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 60:
	
	

regs[0] = (regs[0] & 1) | (regs[1] & 0x0f ? 0 : 16) | 2;
regs[1] = (regs[1] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[1] == 0x80 ? 4 : 0 ) | ( regs[1] & 0x0f ? 0 : 16 ) | sz53Table[regs[1]];
	break;case 61:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[1] & 0x0f ? 0 : 16 ) | 2;
regs[1] = (regs[1] - 1) ;


regs[0] |= (regs[1] == 0x7f ? 4 : 0) | sz53Table[regs[1]];
	break;case 62:
	
	regs[1] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 63:
	
	regs[0] = ( regs[0] & 196 ) | ( (regs[0] & 1) ? 16 : 1 ) | ( regs[1] & 40 );
	break;case 64:
	
	regs[3] = regs[3];
	break;case 65:
	
	regs[3] = regs[2];
	break;case 66:
	
	regs[3] = regs[5];
	break;case 67:
	
	regs[3] = regs[4];
	break;case 68:
	
	regs[3] = regs[7];
	break;case 69:
	
	regs[3] = regs[6];
	break;case 70:
	
	regs[3] = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
	break;case 71:
	
	regs[3] = regs[1];
	break;case 72:
	
	regs[2] = regs[3];
	break;case 73:
	
	regs[2] = regs[2];
	break;case 74:
	
	regs[2] = regs[5];
	break;case 75:
	
	regs[2] = regs[4];
	break;case 76:
	
	regs[2] = regs[7];
	break;case 77:
	
	regs[2] = regs[6];
	break;case 78:
	
	regs[2] = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
	break;case 79:
	
	regs[2] = regs[1];
	break;case 80:
	
	regs[5] = regs[3];
	break;case 81:
	
	regs[5] = regs[2];
	break;case 82:
	
	regs[5] = regs[5];
	break;case 83:
	
	regs[5] = regs[4];
	break;case 84:
	
	regs[5] = regs[7];
	break;case 85:
	
	regs[5] = regs[6];
	break;case 86:
	
	regs[5] = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
	break;case 87:
	
	regs[5] = regs[1];
	break;case 88:
	
	regs[4] = regs[3];
	break;case 89:
	
	regs[4] = regs[2];
	break;case 90:
	
	regs[4] = regs[5];
	break;case 91:
	
	regs[4] = regs[4];
	break;case 92:
	
	regs[4] = regs[7];
	break;case 93:
	
	regs[4] = regs[6];
	break;case 94:
	
	regs[4] = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
	break;case 95:
	
	regs[4] = regs[1];
	break;case 96:
	
	regs[7] = regs[3];
	break;case 97:
	
	regs[7] = regs[2];
	break;case 98:
	
	regs[7] = regs[5];
	break;case 99:
	
	regs[7] = regs[4];
	break;case 100:
	
	regs[7] = regs[7];
	break;case 101:
	
	regs[7] = regs[6];
	break;case 102:
	
	regs[7] = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
	break;case 103:
	
	regs[7] = regs[1];
	break;case 104:
	
	regs[6] = regs[3];
	break;case 105:
	
	regs[6] = regs[2];
	break;case 106:
	
	regs[6] = regs[5];
	break;case 107:
	
	regs[6] = regs[4];
	break;case 108:
	
	regs[6] = regs[7];
	break;case 109:
	
	regs[6] = regs[6];
	break;case 110:
	
	regs[6] = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
	break;case 111:
	
	regs[6] = regs[1];
	break;case 112:
	
	(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], regs[3]);;
	break;case 113:
	
	(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], regs[2]);;
	break;case 114:
	
	(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], regs[5]);;
	break;case 115:
	
	(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], regs[4]);;
	break;case 116:
	
	(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], regs[7]);;
	break;case 117:
	
	(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], regs[6]);;
	break;case 118:
	
	halted = true;
regPairs[12]--;
	break;case 119:
	
	(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], regs[1]);;
	break;case 120:
	
	regs[1] = regs[3];
	break;case 121:
	
	regs[1] = regs[2];
	break;case 122:
	
	regs[1] = regs[5];
	break;case 123:
	
	regs[1] = regs[4];
	break;case 124:
	
	regs[1] = regs[7];
	break;case 125:
	
	regs[1] = regs[6];
	break;case 126:
	
	regs[1] = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
	break;case 127:
	
	regs[1] = regs[1];
	break;case 128:
	
	

var addtemp = regs[1] + regs[3];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[3] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 129:
	
	

var addtemp = regs[1] + regs[2];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[2] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 130:
	
	

var addtemp = regs[1] + regs[5];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[5] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 131:
	
	

var addtemp = regs[1] + regs[4];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[4] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 132:
	
	

var addtemp = regs[1] + regs[7];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[7] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 133:
	
	

var addtemp = regs[1] + regs[6];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[6] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 134:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));

var addtemp = regs[1] + val;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 135:
	
	

var addtemp = regs[1] + regs[1];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[1] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 136:
	
	

var adctemp = regs[1] + regs[3] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[3] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 137:
	
	

var adctemp = regs[1] + regs[2] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[2] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 138:
	
	

var adctemp = regs[1] + regs[5] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[5] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 139:
	
	

var adctemp = regs[1] + regs[4] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[4] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 140:
	
	

var adctemp = regs[1] + regs[7] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[7] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 141:
	
	

var adctemp = regs[1] + regs[6] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[6] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 142:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));

var adctemp = regs[1] + val + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 143:
	
	

var adctemp = regs[1] + regs[1] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[1] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 144:
	
	
var subtemp = regs[1] - regs[3];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[3] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 145:
	
	
var subtemp = regs[1] - regs[2];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[2] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 146:
	
	
var subtemp = regs[1] - regs[5];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[5] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 147:
	
	
var subtemp = regs[1] - regs[4];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[4] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 148:
	
	
var subtemp = regs[1] - regs[7];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[7] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 149:
	
	
var subtemp = regs[1] - regs[6];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[6] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 150:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
var subtemp = regs[1] - val;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 151:
	
	
var subtemp = regs[1] - regs[1];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[1] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 152:
	
	
var sbctemp = regs[1] - regs[3] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[3] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 153:
	
	
var sbctemp = regs[1] - regs[2] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[2] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 154:
	
	
var sbctemp = regs[1] - regs[5] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[5] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 155:
	
	
var sbctemp = regs[1] - regs[4] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[4] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 156:
	
	
var sbctemp = regs[1] - regs[7] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[7] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 157:
	
	
var sbctemp = regs[1] - regs[6] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[6] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 158:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
var sbctemp = regs[1] - val - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 159:
	
	
var sbctemp = regs[1] - regs[1] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[1] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 160:
	
	

regs[1] &= regs[3];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 161:
	
	

regs[1] &= regs[2];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 162:
	
	

regs[1] &= regs[5];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 163:
	
	

regs[1] &= regs[4];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 164:
	
	

regs[1] &= regs[7];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 165:
	
	

regs[1] &= regs[6];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 166:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));

regs[1] &= val;
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 167:
	
	

regs[1] &= regs[1];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 168:
	
	
regs[1] ^= regs[3];
regs[0] = sz53pTable[regs[1]];
	break;case 169:
	
	
regs[1] ^= regs[2];
regs[0] = sz53pTable[regs[1]];
	break;case 170:
	
	
regs[1] ^= regs[5];
regs[0] = sz53pTable[regs[1]];
	break;case 171:
	
	
regs[1] ^= regs[4];
regs[0] = sz53pTable[regs[1]];
	break;case 172:
	
	
regs[1] ^= regs[7];
regs[0] = sz53pTable[regs[1]];
	break;case 173:
	
	
regs[1] ^= regs[6];
regs[0] = sz53pTable[regs[1]];
	break;case 174:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
regs[1] ^= val;
regs[0] = sz53pTable[regs[1]];
	break;case 175:
	
	
regs[1] ^= regs[1];
regs[0] = sz53pTable[regs[1]];
	break;case 176:
	
	

regs[1] |= regs[3];
regs[0] = sz53pTable[regs[1]];
	break;case 177:
	
	

regs[1] |= regs[2];
regs[0] = sz53pTable[regs[1]];
	break;case 178:
	
	

regs[1] |= regs[5];
regs[0] = sz53pTable[regs[1]];
	break;case 179:
	
	

regs[1] |= regs[4];
regs[0] = sz53pTable[regs[1]];
	break;case 180:
	
	

regs[1] |= regs[7];
regs[0] = sz53pTable[regs[1]];
	break;case 181:
	
	

regs[1] |= regs[6];
regs[0] = sz53pTable[regs[1]];
	break;case 182:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));

regs[1] |= val;
regs[0] = sz53pTable[regs[1]];
	break;case 183:
	
	

regs[1] |= regs[1];
regs[0] = sz53pTable[regs[1]];
	break;case 184:
	
	

var cptemp = regs[1] - regs[3];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[3] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[3] & 40 ) | ( cptemp & 128 );
	break;case 185:
	
	

var cptemp = regs[1] - regs[2];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[2] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[2] & 40 ) | ( cptemp & 128 );
	break;case 186:
	
	

var cptemp = regs[1] - regs[5];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[5] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[5] & 40 ) | ( cptemp & 128 );
	break;case 187:
	
	

var cptemp = regs[1] - regs[4];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[4] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[4] & 40 ) | ( cptemp & 128 );
	break;case 188:
	
	

var cptemp = regs[1] - regs[7];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[7] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[7] & 40 ) | ( cptemp & 128 );
	break;case 189:
	
	

var cptemp = regs[1] - regs[6];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[6] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[6] & 40 ) | ( cptemp & 128 );
	break;case 190:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));

var cptemp = regs[1] - val;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( val & 40 ) | ( cptemp & 128 );
	break;case 191:
	
	

var cptemp = regs[1] - regs[1];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[1] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[1] & 40 ) | ( cptemp & 128 );
	break;case 192:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (!(regs[0] & 64)) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 193:
	
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
regPairs[1] = (h<<8) | l;
	break;case 194:
	
	if (!(regs[0] & 64)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 195:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
regPairs[12] = (h<<8) | l;
	break;case 196:
	
	if (!(regs[0] & 64)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 197:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[1] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[1] & 0xff);;
	break;case 198:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;

var addtemp = regs[1] + val;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 199:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 0;
	break;case 200:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (regs[0] & 64) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 201:
	
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++; 
regPairs[12] = (h<<8) | l;
	break;case 202:
	
	if (regs[0] & 64) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 203:
	
	opcodePrefix = 'CB';
interruptible = false;
	break;case 204:
	
	if (regs[0] & 64) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 205:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = (h<<8) | l;
	break;case 206:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;

var adctemp = regs[1] + val + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 207:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 8;
	break;case 208:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (!(regs[0] & 1)) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 209:
	
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
regPairs[2] = (h<<8) | l;
	break;case 210:
	
	if (!(regs[0] & 1)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 211:
	
	var port = (regs[1] << 8) | ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var isContendedMemory = memory.isContended(port);
var isULAPort = ioBus.isULAPort(port);
if (isContendedMemory) tstates += ioBus.contend(port, tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
ioBus.write(port, regs[1], tstates);
if (isContendedMemory || isULAPort) {
	ioBus.contend(port);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(port); tstates += 1;
		ioBus.contend(port); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
	break;case 212:
	
	if (!(regs[0] & 1)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 213:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[2] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[2] & 0xff);;
	break;case 214:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var subtemp = regs[1] - val;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 215:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 16;
	break;case 216:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (regs[0] & 1) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 217:
	
	var wordtemp;
wordtemp = regPairs[1]; regPairs[1] = regPairs[5]; regPairs[5] = wordtemp;
wordtemp = regPairs[2]; regPairs[2] = regPairs[6]; regPairs[6] = wordtemp;
wordtemp = regPairs[3]; regPairs[3] = regPairs[7]; regPairs[7] = wordtemp;
	break;case 218:
	
	if (regs[0] & 1) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 219:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var port = (regs[1] << 8) | val;
var isContendedMemory = memory.isContended(port);
var isULAPort = ioBus.isULAPort(port);
if (isContendedMemory) tstates += ioBus.contend(port, tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
regs[1] = ioBus.read(port);
if (isContendedMemory || isULAPort) {
	ioBus.contend(port);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(port); tstates += 1;
		ioBus.contend(port); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
	break;case 220:
	
	if (regs[0] & 1) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 221:
	
	opcodePrefix = 'DD';
interruptible = false;
	break;case 222:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var sbctemp = regs[1] - val - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 223:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 24;
	break;case 224:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (!(regs[0] & 4)) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 225:
	
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
regPairs[3] = (h<<8) | l;
	break;case 226:
	
	if (!(regs[0] & 4)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 227:
	
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11]));
var spPlus1 = (regPairs[11] + 1) & 0xffff;
var h = ((tstates += memory.contend(spPlus1, tstates) + ( 3)), memory.read(spPlus1));
(tstates += memory.contend(spPlus1, tstates) + ( 1));
(tstates += memory.contend(spPlus1, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(spPlus1, regPairs[3] >> 8);;
(tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[3] & 0xff);;
regPairs[3] = (h<<8) | l;
(tstates += memory.contend(regPairs[11], tstates) + ( 1));
(tstates += memory.contend(regPairs[11], tstates) + ( 1));
	break;case 228:
	
	if (!(regs[0] & 4)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 229:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[3] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[3] & 0xff);;
	break;case 230:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;

regs[1] &= val;
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 231:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 32;
	break;case 232:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (regs[0] & 4) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 233:
	
	regPairs[12] = regPairs[3];
	break;case 234:
	
	if (regs[0] & 4) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 235:
	
	var temp = regPairs[2];
regPairs[2] = regPairs[3];
regPairs[3] = temp;
	break;case 236:
	
	if (regs[0] & 4) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 237:
	
	opcodePrefix = 'ED';
interruptible = false;
	break;case 238:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
regs[1] ^= val;
regs[0] = sz53pTable[regs[1]];
	break;case 239:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 40;
	break;case 240:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (!(regs[0] & 128)) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 241:
	
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
regPairs[0] = (h<<8) | l;
	break;case 242:
	
	if (!(regs[0] & 128)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 243:
	
	iff1 = iff2 = 0;
	break;case 244:
	
	if (!(regs[0] & 128)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 245:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[0] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[0] & 0xff);;
	break;case 246:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;

regs[1] |= val;
regs[0] = sz53pTable[regs[1]];
	break;case 247:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 48;
	break;case 248:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (regs[0] & 128) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 249:
	
	regPairs[11] = regPairs[3];
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 250:
	
	if (regs[0] & 128) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 251:
	
	iff1 = iff2 = 1;
interruptible = false;
	break;case 252:
	
	if (regs[0] & 128) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 253:
	
	opcodePrefix = 'FD';
interruptible = false;
	break;case 254:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;

var cptemp = regs[1] - val;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( val & 40 ) | ( cptemp & 128 );
	break;case 255:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 56;
	break;
	default:
		var addr = regPairs[12] - 1;
		throw("Unimplemented opcode " + opcode + " in page 0 - PC = " + addr);
}
					break;
				case 'CB':
					(tstates += memory.contend(regPairs[12], tstates) + ( 4));
					opcode = memory.read(regPairs[12]); regPairs[12]++;
					regs[20] = ((regs[20] + 1) & 0x7f) | (regs[20] & 0x80);
					switch (opcode) {
	case 0:
	
	
regs[3] = ( (regs[3] << 1) | (regs[3] >> 7) ) ;
regs[0] = (regs[3] & 1) | sz53pTable[regs[3]];

	break;case 1:
	
	
regs[2] = ( (regs[2] << 1) | (regs[2] >> 7) ) ;
regs[0] = (regs[2] & 1) | sz53pTable[regs[2]];

	break;case 2:
	
	
regs[5] = ( (regs[5] << 1) | (regs[5] >> 7) ) ;
regs[0] = (regs[5] & 1) | sz53pTable[regs[5]];

	break;case 3:
	
	
regs[4] = ( (regs[4] << 1) | (regs[4] >> 7) ) ;
regs[0] = (regs[4] & 1) | sz53pTable[regs[4]];

	break;case 4:
	
	
regs[7] = ( (regs[7] << 1) | (regs[7] >> 7) ) ;
regs[0] = (regs[7] & 1) | sz53pTable[regs[7]];

	break;case 5:
	
	
regs[6] = ( (regs[6] << 1) | (regs[6] >> 7) ) ;
regs[0] = (regs[6] & 1) | sz53pTable[regs[6]];

	break;case 6:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
val = ( (val << 1) | (val >> 7) ) & 0xff;
regs[0] = (val & 1) | sz53pTable[val];
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 7:
	
	
regs[1] = ( (regs[1] << 1) | (regs[1] >> 7) ) ;
regs[0] = (regs[1] & 1) | sz53pTable[regs[1]];

	break;case 8:
	
	
regs[0] = regs[3] & 1;
regs[3] = ( (regs[3] >> 1) | (regs[3] << 7) ) ;
regs[0] |= sz53pTable[regs[3]];

	break;case 9:
	
	
regs[0] = regs[2] & 1;
regs[2] = ( (regs[2] >> 1) | (regs[2] << 7) ) ;
regs[0] |= sz53pTable[regs[2]];

	break;case 10:
	
	
regs[0] = regs[5] & 1;
regs[5] = ( (regs[5] >> 1) | (regs[5] << 7) ) ;
regs[0] |= sz53pTable[regs[5]];

	break;case 11:
	
	
regs[0] = regs[4] & 1;
regs[4] = ( (regs[4] >> 1) | (regs[4] << 7) ) ;
regs[0] |= sz53pTable[regs[4]];

	break;case 12:
	
	
regs[0] = regs[7] & 1;
regs[7] = ( (regs[7] >> 1) | (regs[7] << 7) ) ;
regs[0] |= sz53pTable[regs[7]];

	break;case 13:
	
	
regs[0] = regs[6] & 1;
regs[6] = ( (regs[6] >> 1) | (regs[6] << 7) ) ;
regs[0] |= sz53pTable[regs[6]];

	break;case 14:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
regs[0] = val & 1;
val = ( (val >> 1) | (val << 7) ) & 0xff;
regs[0] |= sz53pTable[val];
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 15:
	
	
regs[0] = regs[1] & 1;
regs[1] = ( (regs[1] >> 1) | (regs[1] << 7) ) ;
regs[0] |= sz53pTable[regs[1]];

	break;case 16:
	
	
var rltemp = regs[3];
regs[3] = ( (regs[3] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[3]];

	break;case 17:
	
	
var rltemp = regs[2];
regs[2] = ( (regs[2] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[2]];

	break;case 18:
	
	
var rltemp = regs[5];
regs[5] = ( (regs[5] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[5]];

	break;case 19:
	
	
var rltemp = regs[4];
regs[4] = ( (regs[4] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[4]];

	break;case 20:
	
	
var rltemp = regs[7];
regs[7] = ( (regs[7] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[7]];

	break;case 21:
	
	
var rltemp = regs[6];
regs[6] = ( (regs[6] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[6]];

	break;case 22:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
var rltemp = val;
val = ( (val << 1) | (regs[0] & 1) ) & 0xff;
regs[0] = ( rltemp >> 7 ) | sz53pTable[val];
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 23:
	
	
var rltemp = regs[1];
regs[1] = ( (regs[1] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[1]];

	break;case 24:
	
	
var rrtemp = regs[3];
regs[3] = ( (regs[3] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[3]];

	break;case 25:
	
	
var rrtemp = regs[2];
regs[2] = ( (regs[2] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[2]];

	break;case 26:
	
	
var rrtemp = regs[5];
regs[5] = ( (regs[5] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[5]];

	break;case 27:
	
	
var rrtemp = regs[4];
regs[4] = ( (regs[4] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[4]];

	break;case 28:
	
	
var rrtemp = regs[7];
regs[7] = ( (regs[7] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[7]];

	break;case 29:
	
	
var rrtemp = regs[6];
regs[6] = ( (regs[6] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[6]];

	break;case 30:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
var rrtemp = val;
val = ( (val >> 1) | ( regs[0] << 7 ) ) & 0xff;
regs[0] = (rrtemp & 1) | sz53pTable[val];
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 31:
	
	
var rrtemp = regs[1];
regs[1] = ( (regs[1] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[1]];

	break;case 32:
	
	
regs[0] = regs[3] >> 7;
regs[3] = (regs[3] << 1) ;
regs[0] |= sz53pTable[regs[3]];

	break;case 33:
	
	
regs[0] = regs[2] >> 7;
regs[2] = (regs[2] << 1) ;
regs[0] |= sz53pTable[regs[2]];

	break;case 34:
	
	
regs[0] = regs[5] >> 7;
regs[5] = (regs[5] << 1) ;
regs[0] |= sz53pTable[regs[5]];

	break;case 35:
	
	
regs[0] = regs[4] >> 7;
regs[4] = (regs[4] << 1) ;
regs[0] |= sz53pTable[regs[4]];

	break;case 36:
	
	
regs[0] = regs[7] >> 7;
regs[7] = (regs[7] << 1) ;
regs[0] |= sz53pTable[regs[7]];

	break;case 37:
	
	
regs[0] = regs[6] >> 7;
regs[6] = (regs[6] << 1) ;
regs[0] |= sz53pTable[regs[6]];

	break;case 38:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
regs[0] = val >> 7;
val = (val << 1) & 0xff;
regs[0] |= sz53pTable[val];
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 39:
	
	
regs[0] = regs[1] >> 7;
regs[1] = (regs[1] << 1) ;
regs[0] |= sz53pTable[regs[1]];

	break;case 40:
	
	
regs[0] = regs[3] & 1;
regs[3] = ( (regs[3] & 0x80) | (regs[3] >> 1) ) ;
regs[0] |= sz53pTable[regs[3]];

	break;case 41:
	
	
regs[0] = regs[2] & 1;
regs[2] = ( (regs[2] & 0x80) | (regs[2] >> 1) ) ;
regs[0] |= sz53pTable[regs[2]];

	break;case 42:
	
	
regs[0] = regs[5] & 1;
regs[5] = ( (regs[5] & 0x80) | (regs[5] >> 1) ) ;
regs[0] |= sz53pTable[regs[5]];

	break;case 43:
	
	
regs[0] = regs[4] & 1;
regs[4] = ( (regs[4] & 0x80) | (regs[4] >> 1) ) ;
regs[0] |= sz53pTable[regs[4]];

	break;case 44:
	
	
regs[0] = regs[7] & 1;
regs[7] = ( (regs[7] & 0x80) | (regs[7] >> 1) ) ;
regs[0] |= sz53pTable[regs[7]];

	break;case 45:
	
	
regs[0] = regs[6] & 1;
regs[6] = ( (regs[6] & 0x80) | (regs[6] >> 1) ) ;
regs[0] |= sz53pTable[regs[6]];

	break;case 46:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
regs[0] = val & 1;
val = ( (val & 0x80) | (val >> 1) ) & 0xff;
regs[0] |= sz53pTable[val];
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 47:
	
	
regs[0] = regs[1] & 1;
regs[1] = ( (regs[1] & 0x80) | (regs[1] >> 1) ) ;
regs[0] |= sz53pTable[regs[1]];

	break;case 48:
	
	
regs[0] =  regs[3] >> 7;
regs[3] = (((regs[3]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[3]];

	break;case 49:
	
	
regs[0] =  regs[2] >> 7;
regs[2] = (((regs[2]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[2]];

	break;case 50:
	
	
regs[0] =  regs[5] >> 7;
regs[5] = (((regs[5]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[5]];

	break;case 51:
	
	
regs[0] =  regs[4] >> 7;
regs[4] = (((regs[4]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[4]];

	break;case 52:
	
	
regs[0] =  regs[7] >> 7;
regs[7] = (((regs[7]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[7]];

	break;case 53:
	
	
regs[0] =  regs[6] >> 7;
regs[6] = (((regs[6]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[6]];

	break;case 54:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
regs[0] =  val >> 7;
val = (((val) << 1) & 0xff) | 0x01;
regs[0] |= sz53pTable[val];
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 55:
	
	
regs[0] =  regs[1] >> 7;
regs[1] = (((regs[1]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[1]];

	break;case 56:
	
	
regs[0] =  regs[3] & 1;
regs[3] >>= 1;
regs[0] |= sz53pTable[regs[3]];

	break;case 57:
	
	
regs[0] =  regs[2] & 1;
regs[2] >>= 1;
regs[0] |= sz53pTable[regs[2]];

	break;case 58:
	
	
regs[0] =  regs[5] & 1;
regs[5] >>= 1;
regs[0] |= sz53pTable[regs[5]];

	break;case 59:
	
	
regs[0] =  regs[4] & 1;
regs[4] >>= 1;
regs[0] |= sz53pTable[regs[4]];

	break;case 60:
	
	
regs[0] =  regs[7] & 1;
regs[7] >>= 1;
regs[0] |= sz53pTable[regs[7]];

	break;case 61:
	
	
regs[0] =  regs[6] & 1;
regs[6] >>= 1;
regs[0] |= sz53pTable[regs[6]];

	break;case 62:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
regs[0] =  val & 1;
val >>= 1;
regs[0] |= sz53pTable[val];
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 63:
	
	
regs[0] =  regs[1] & 1;
regs[1] >>= 1;
regs[0] |= sz53pTable[regs[1]];

	break;case 64:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[3] & 40 );
if( !(regs[3] & 1) ) regs[0] |= 68;

	break;case 65:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[2] & 40 );
if( !(regs[2] & 1) ) regs[0] |= 68;

	break;case 66:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[5] & 40 );
if( !(regs[5] & 1) ) regs[0] |= 68;

	break;case 67:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[4] & 40 );
if( !(regs[4] & 1) ) regs[0] |= 68;

	break;case 68:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[7] & 40 );
if( !(regs[7] & 1) ) regs[0] |= 68;

	break;case 69:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[6] & 40 );
if( !(regs[6] & 1) ) regs[0] |= 68;

	break;case 70:
	
	var addr = regPairs[3];
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
(tstates += memory.contend(addr, tstates) + ( 1));
regs[0] = ( regs[0] & 1 ) | 16 | ( value & 40 );
if( !(value & 1) ) regs[0] |= 68;

	break;case 71:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[1] & 40 );
if( !(regs[1] & 1) ) regs[0] |= 68;

	break;case 72:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[3] & 40 );
if( !(regs[3] & 2) ) regs[0] |= 68;

	break;case 73:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[2] & 40 );
if( !(regs[2] & 2) ) regs[0] |= 68;

	break;case 74:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[5] & 40 );
if( !(regs[5] & 2) ) regs[0] |= 68;

	break;case 75:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[4] & 40 );
if( !(regs[4] & 2) ) regs[0] |= 68;

	break;case 76:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[7] & 40 );
if( !(regs[7] & 2) ) regs[0] |= 68;

	break;case 77:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[6] & 40 );
if( !(regs[6] & 2) ) regs[0] |= 68;

	break;case 78:
	
	var addr = regPairs[3];
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
(tstates += memory.contend(addr, tstates) + ( 1));
regs[0] = ( regs[0] & 1 ) | 16 | ( value & 40 );
if( !(value & 2) ) regs[0] |= 68;

	break;case 79:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[1] & 40 );
if( !(regs[1] & 2) ) regs[0] |= 68;

	break;case 80:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[3] & 40 );
if( !(regs[3] & 4) ) regs[0] |= 68;

	break;case 81:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[2] & 40 );
if( !(regs[2] & 4) ) regs[0] |= 68;

	break;case 82:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[5] & 40 );
if( !(regs[5] & 4) ) regs[0] |= 68;

	break;case 83:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[4] & 40 );
if( !(regs[4] & 4) ) regs[0] |= 68;

	break;case 84:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[7] & 40 );
if( !(regs[7] & 4) ) regs[0] |= 68;

	break;case 85:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[6] & 40 );
if( !(regs[6] & 4) ) regs[0] |= 68;

	break;case 86:
	
	var addr = regPairs[3];
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
(tstates += memory.contend(addr, tstates) + ( 1));
regs[0] = ( regs[0] & 1 ) | 16 | ( value & 40 );
if( !(value & 4) ) regs[0] |= 68;

	break;case 87:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[1] & 40 );
if( !(regs[1] & 4) ) regs[0] |= 68;

	break;case 88:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[3] & 40 );
if( !(regs[3] & 8) ) regs[0] |= 68;

	break;case 89:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[2] & 40 );
if( !(regs[2] & 8) ) regs[0] |= 68;

	break;case 90:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[5] & 40 );
if( !(regs[5] & 8) ) regs[0] |= 68;

	break;case 91:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[4] & 40 );
if( !(regs[4] & 8) ) regs[0] |= 68;

	break;case 92:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[7] & 40 );
if( !(regs[7] & 8) ) regs[0] |= 68;

	break;case 93:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[6] & 40 );
if( !(regs[6] & 8) ) regs[0] |= 68;

	break;case 94:
	
	var addr = regPairs[3];
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
(tstates += memory.contend(addr, tstates) + ( 1));
regs[0] = ( regs[0] & 1 ) | 16 | ( value & 40 );
if( !(value & 8) ) regs[0] |= 68;

	break;case 95:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[1] & 40 );
if( !(regs[1] & 8) ) regs[0] |= 68;

	break;case 96:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[3] & 40 );
if( !(regs[3] & 16) ) regs[0] |= 68;

	break;case 97:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[2] & 40 );
if( !(regs[2] & 16) ) regs[0] |= 68;

	break;case 98:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[5] & 40 );
if( !(regs[5] & 16) ) regs[0] |= 68;

	break;case 99:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[4] & 40 );
if( !(regs[4] & 16) ) regs[0] |= 68;

	break;case 100:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[7] & 40 );
if( !(regs[7] & 16) ) regs[0] |= 68;

	break;case 101:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[6] & 40 );
if( !(regs[6] & 16) ) regs[0] |= 68;

	break;case 102:
	
	var addr = regPairs[3];
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
(tstates += memory.contend(addr, tstates) + ( 1));
regs[0] = ( regs[0] & 1 ) | 16 | ( value & 40 );
if( !(value & 16) ) regs[0] |= 68;

	break;case 103:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[1] & 40 );
if( !(regs[1] & 16) ) regs[0] |= 68;

	break;case 104:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[3] & 40 );
if( !(regs[3] & 32) ) regs[0] |= 68;

	break;case 105:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[2] & 40 );
if( !(regs[2] & 32) ) regs[0] |= 68;

	break;case 106:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[5] & 40 );
if( !(regs[5] & 32) ) regs[0] |= 68;

	break;case 107:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[4] & 40 );
if( !(regs[4] & 32) ) regs[0] |= 68;

	break;case 108:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[7] & 40 );
if( !(regs[7] & 32) ) regs[0] |= 68;

	break;case 109:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[6] & 40 );
if( !(regs[6] & 32) ) regs[0] |= 68;

	break;case 110:
	
	var addr = regPairs[3];
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
(tstates += memory.contend(addr, tstates) + ( 1));
regs[0] = ( regs[0] & 1 ) | 16 | ( value & 40 );
if( !(value & 32) ) regs[0] |= 68;

	break;case 111:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[1] & 40 );
if( !(regs[1] & 32) ) regs[0] |= 68;

	break;case 112:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[3] & 40 );
if( !(regs[3] & 64) ) regs[0] |= 68;

	break;case 113:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[2] & 40 );
if( !(regs[2] & 64) ) regs[0] |= 68;

	break;case 114:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[5] & 40 );
if( !(regs[5] & 64) ) regs[0] |= 68;

	break;case 115:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[4] & 40 );
if( !(regs[4] & 64) ) regs[0] |= 68;

	break;case 116:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[7] & 40 );
if( !(regs[7] & 64) ) regs[0] |= 68;

	break;case 117:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[6] & 40 );
if( !(regs[6] & 64) ) regs[0] |= 68;

	break;case 118:
	
	var addr = regPairs[3];
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
(tstates += memory.contend(addr, tstates) + ( 1));
regs[0] = ( regs[0] & 1 ) | 16 | ( value & 40 );
if( !(value & 64) ) regs[0] |= 68;

	break;case 119:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[1] & 40 );
if( !(regs[1] & 64) ) regs[0] |= 68;

	break;case 120:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[3] & 40 );
if( !(regs[3] & 128) ) regs[0] |= 68;
if (regs[3] & 0x80) regs[0] |= 128;
	break;case 121:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[2] & 40 );
if( !(regs[2] & 128) ) regs[0] |= 68;
if (regs[2] & 0x80) regs[0] |= 128;
	break;case 122:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[5] & 40 );
if( !(regs[5] & 128) ) regs[0] |= 68;
if (regs[5] & 0x80) regs[0] |= 128;
	break;case 123:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[4] & 40 );
if( !(regs[4] & 128) ) regs[0] |= 68;
if (regs[4] & 0x80) regs[0] |= 128;
	break;case 124:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[7] & 40 );
if( !(regs[7] & 128) ) regs[0] |= 68;
if (regs[7] & 0x80) regs[0] |= 128;
	break;case 125:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[6] & 40 );
if( !(regs[6] & 128) ) regs[0] |= 68;
if (regs[6] & 0x80) regs[0] |= 128;
	break;case 126:
	
	var addr = regPairs[3];
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
(tstates += memory.contend(addr, tstates) + ( 1));
regs[0] = ( regs[0] & 1 ) | 16 | ( value & 40 );
if( !(value & 128) ) regs[0] |= 68;
if (value & 0x80) regs[0] |= 128;
	break;case 127:
	
	regs[0] = ( regs[0] & 1 ) | 16 | ( regs[1] & 40 );
if( !(regs[1] & 128) ) regs[0] |= 68;
if (regs[1] & 0x80) regs[0] |= 128;
	break;case 128:
	
	
regs[3] &= 254;

	break;case 129:
	
	
regs[2] &= 254;

	break;case 130:
	
	
regs[5] &= 254;

	break;case 131:
	
	
regs[4] &= 254;

	break;case 132:
	
	
regs[7] &= 254;

	break;case 133:
	
	
regs[6] &= 254;

	break;case 134:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
val &= 254;
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 135:
	
	
regs[1] &= 254;

	break;case 136:
	
	
regs[3] &= 253;

	break;case 137:
	
	
regs[2] &= 253;

	break;case 138:
	
	
regs[5] &= 253;

	break;case 139:
	
	
regs[4] &= 253;

	break;case 140:
	
	
regs[7] &= 253;

	break;case 141:
	
	
regs[6] &= 253;

	break;case 142:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
val &= 253;
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 143:
	
	
regs[1] &= 253;

	break;case 144:
	
	
regs[3] &= 251;

	break;case 145:
	
	
regs[2] &= 251;

	break;case 146:
	
	
regs[5] &= 251;

	break;case 147:
	
	
regs[4] &= 251;

	break;case 148:
	
	
regs[7] &= 251;

	break;case 149:
	
	
regs[6] &= 251;

	break;case 150:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
val &= 251;
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 151:
	
	
regs[1] &= 251;

	break;case 152:
	
	
regs[3] &= 247;

	break;case 153:
	
	
regs[2] &= 247;

	break;case 154:
	
	
regs[5] &= 247;

	break;case 155:
	
	
regs[4] &= 247;

	break;case 156:
	
	
regs[7] &= 247;

	break;case 157:
	
	
regs[6] &= 247;

	break;case 158:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
val &= 247;
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 159:
	
	
regs[1] &= 247;

	break;case 160:
	
	
regs[3] &= 239;

	break;case 161:
	
	
regs[2] &= 239;

	break;case 162:
	
	
regs[5] &= 239;

	break;case 163:
	
	
regs[4] &= 239;

	break;case 164:
	
	
regs[7] &= 239;

	break;case 165:
	
	
regs[6] &= 239;

	break;case 166:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
val &= 239;
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 167:
	
	
regs[1] &= 239;

	break;case 168:
	
	
regs[3] &= 223;

	break;case 169:
	
	
regs[2] &= 223;

	break;case 170:
	
	
regs[5] &= 223;

	break;case 171:
	
	
regs[4] &= 223;

	break;case 172:
	
	
regs[7] &= 223;

	break;case 173:
	
	
regs[6] &= 223;

	break;case 174:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
val &= 223;
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 175:
	
	
regs[1] &= 223;

	break;case 176:
	
	
regs[3] &= 191;

	break;case 177:
	
	
regs[2] &= 191;

	break;case 178:
	
	
regs[5] &= 191;

	break;case 179:
	
	
regs[4] &= 191;

	break;case 180:
	
	
regs[7] &= 191;

	break;case 181:
	
	
regs[6] &= 191;

	break;case 182:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
val &= 191;
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 183:
	
	
regs[1] &= 191;

	break;case 184:
	
	
regs[3] &= 127;

	break;case 185:
	
	
regs[2] &= 127;

	break;case 186:
	
	
regs[5] &= 127;

	break;case 187:
	
	
regs[4] &= 127;

	break;case 188:
	
	
regs[7] &= 127;

	break;case 189:
	
	
regs[6] &= 127;

	break;case 190:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
val &= 127;
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 191:
	
	
regs[1] &= 127;

	break;case 192:
	
	
regs[3] |= 1;

	break;case 193:
	
	
regs[2] |= 1;

	break;case 194:
	
	
regs[5] |= 1;

	break;case 195:
	
	
regs[4] |= 1;

	break;case 196:
	
	
regs[7] |= 1;

	break;case 197:
	
	
regs[6] |= 1;

	break;case 198:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
val |= 1;
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 199:
	
	
regs[1] |= 1;

	break;case 200:
	
	
regs[3] |= 2;

	break;case 201:
	
	
regs[2] |= 2;

	break;case 202:
	
	
regs[5] |= 2;

	break;case 203:
	
	
regs[4] |= 2;

	break;case 204:
	
	
regs[7] |= 2;

	break;case 205:
	
	
regs[6] |= 2;

	break;case 206:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
val |= 2;
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 207:
	
	
regs[1] |= 2;

	break;case 208:
	
	
regs[3] |= 4;

	break;case 209:
	
	
regs[2] |= 4;

	break;case 210:
	
	
regs[5] |= 4;

	break;case 211:
	
	
regs[4] |= 4;

	break;case 212:
	
	
regs[7] |= 4;

	break;case 213:
	
	
regs[6] |= 4;

	break;case 214:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
val |= 4;
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 215:
	
	
regs[1] |= 4;

	break;case 216:
	
	
regs[3] |= 8;

	break;case 217:
	
	
regs[2] |= 8;

	break;case 218:
	
	
regs[5] |= 8;

	break;case 219:
	
	
regs[4] |= 8;

	break;case 220:
	
	
regs[7] |= 8;

	break;case 221:
	
	
regs[6] |= 8;

	break;case 222:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
val |= 8;
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 223:
	
	
regs[1] |= 8;

	break;case 224:
	
	
regs[3] |= 16;

	break;case 225:
	
	
regs[2] |= 16;

	break;case 226:
	
	
regs[5] |= 16;

	break;case 227:
	
	
regs[4] |= 16;

	break;case 228:
	
	
regs[7] |= 16;

	break;case 229:
	
	
regs[6] |= 16;

	break;case 230:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
val |= 16;
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 231:
	
	
regs[1] |= 16;

	break;case 232:
	
	
regs[3] |= 32;

	break;case 233:
	
	
regs[2] |= 32;

	break;case 234:
	
	
regs[5] |= 32;

	break;case 235:
	
	
regs[4] |= 32;

	break;case 236:
	
	
regs[7] |= 32;

	break;case 237:
	
	
regs[6] |= 32;

	break;case 238:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
val |= 32;
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 239:
	
	
regs[1] |= 32;

	break;case 240:
	
	
regs[3] |= 64;

	break;case 241:
	
	
regs[2] |= 64;

	break;case 242:
	
	
regs[5] |= 64;

	break;case 243:
	
	
regs[4] |= 64;

	break;case 244:
	
	
regs[7] |= 64;

	break;case 245:
	
	
regs[6] |= 64;

	break;case 246:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
val |= 64;
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 247:
	
	
regs[1] |= 64;

	break;case 248:
	
	
regs[3] |= 128;

	break;case 249:
	
	
regs[2] |= 128;

	break;case 250:
	
	
regs[5] |= 128;

	break;case 251:
	
	
regs[4] |= 128;

	break;case 252:
	
	
regs[7] |= 128;

	break;case 253:
	
	
regs[6] |= 128;

	break;case 254:
	
	var val = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
val |= 128;
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
	break;case 255:
	
	
regs[1] |= 128;

	break;
	default:
		var addr = regPairs[12] - 1;
		throw("Unimplemented opcode " + opcode + " in page cb - PC = " + addr);
}
					break;
				case 'DD':
					(tstates += memory.contend(regPairs[12], tstates) + ( 4));
					opcode = memory.read(regPairs[12]); regPairs[12]++;
					regs[20] = ((regs[20] + 1) & 0x7f) | (regs[20] & 0x80);
					switch (opcode) {
	case 0:
	
			
	break;case 1:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
regPairs[1] = (h<<8) | l;
	break;case 2:
	
	(tstates += memory.contend(regPairs[1], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[1], regs[1]);;
	break;case 3:
	
	regPairs[1]++;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 4:
	
	

regs[0] = (regs[0] & 1) | (regs[3] & 0x0f ? 0 : 16) | 2;
regs[3] = (regs[3] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[3] == 0x80 ? 4 : 0 ) | ( regs[3] & 0x0f ? 0 : 16 ) | sz53Table[regs[3]];
	break;case 5:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[3] & 0x0f ? 0 : 16 ) | 2;
regs[3] = (regs[3] - 1) ;


regs[0] |= (regs[3] == 0x7f ? 4 : 0) | sz53Table[regs[3]];
	break;case 6:
	
	regs[3] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 7:
	
	regs[1] = (regs[1] << 1) | (regs[1] >> 7);
regs[0] = (regs[0] & 196) | (regs[1] & 41);
	break;case 8:
	
	var temp = regPairs[0];
regPairs[0] = regPairs[4];
regPairs[4] = temp;
	break;case 9:
	
	var add16temp = regPairs[8] + regPairs[1];
var lookup = ( (regPairs[8] & 0x0800) >> 11 ) | ( (regPairs[1] & 0x0800) >> 10 ) | ( (add16temp & 0x0800) >>  9 );
regPairs[8] = add16temp;
regs[0] = ( regs[0] & ( 196 ) ) | ( add16temp & 0x10000 ? 1 : 0 ) | ( ( add16temp >> 8 ) & ( 40 ) ) | halfcarryAddTable[lookup];
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 10:
	
	regs[1] = ((tstates += memory.contend(regPairs[1], tstates) + ( 3)), memory.read(regPairs[1]));
	break;case 11:
	
	regPairs[1]--;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 12:
	
	

regs[0] = (regs[0] & 1) | (regs[2] & 0x0f ? 0 : 16) | 2;
regs[2] = (regs[2] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[2] == 0x80 ? 4 : 0 ) | ( regs[2] & 0x0f ? 0 : 16 ) | sz53Table[regs[2]];
	break;case 13:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[2] & 0x0f ? 0 : 16 ) | 2;
regs[2] = (regs[2] - 1) ;


regs[0] |= (regs[2] == 0x7f ? 4 : 0) | sz53Table[regs[2]];
	break;case 14:
	
	regs[2] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 15:
	
	regs[0] = (regs[0] & 196) | (regs[1] & 1);
regs[1] = (regs[1] >> 1) | (regs[1] << 7);
regs[0] |= (regs[1] & 40);
	break;case 16:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regs[3]--;
if (regs[3]) {
	/* take branch */
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[12] += (offset & 0x80 ? offset - 0x100 : offset);
} else {
	/* do not take branch */
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 17:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
regPairs[2] = (h<<8) | l;
	break;case 18:
	
	(tstates += memory.contend(regPairs[2], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[2], regs[1]);;
	break;case 19:
	
	regPairs[2]++;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 20:
	
	

regs[0] = (regs[0] & 1) | (regs[5] & 0x0f ? 0 : 16) | 2;
regs[5] = (regs[5] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[5] == 0x80 ? 4 : 0 ) | ( regs[5] & 0x0f ? 0 : 16 ) | sz53Table[regs[5]];
	break;case 21:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[5] & 0x0f ? 0 : 16 ) | 2;
regs[5] = (regs[5] - 1) ;


regs[0] |= (regs[5] == 0x7f ? 4 : 0) | sz53Table[regs[5]];
	break;case 22:
	
	regs[5] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 23:
	
	var bytetemp = regs[1];
regs[1] = (regs[1] << 1) | (regs[0] & 1);
regs[0] = (regs[0] & 196) | (regs[1] & 40) | (bytetemp >> 7);
	break;case 24:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
regPairs[12] += (offset & 0x80 ? offset - 0x100 : offset);
	break;case 25:
	
	var add16temp = regPairs[8] + regPairs[2];
var lookup = ( (regPairs[8] & 0x0800) >> 11 ) | ( (regPairs[2] & 0x0800) >> 10 ) | ( (add16temp & 0x0800) >>  9 );
regPairs[8] = add16temp;
regs[0] = ( regs[0] & ( 196 ) ) | ( add16temp & 0x10000 ? 1 : 0 ) | ( ( add16temp >> 8 ) & ( 40 ) ) | halfcarryAddTable[lookup];
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 26:
	
	regs[1] = ((tstates += memory.contend(regPairs[2], tstates) + ( 3)), memory.read(regPairs[2]));
	break;case 27:
	
	regPairs[2]--;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 28:
	
	

regs[0] = (regs[0] & 1) | (regs[4] & 0x0f ? 0 : 16) | 2;
regs[4] = (regs[4] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[4] == 0x80 ? 4 : 0 ) | ( regs[4] & 0x0f ? 0 : 16 ) | sz53Table[regs[4]];
	break;case 29:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[4] & 0x0f ? 0 : 16 ) | 2;
regs[4] = (regs[4] - 1) ;


regs[0] |= (regs[4] == 0x7f ? 4 : 0) | sz53Table[regs[4]];
	break;case 30:
	
	regs[4] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 31:
	
	var bytetemp = regs[1];
regs[1] = (bytetemp >> 1) | (regs[0] << 7);
regs[0] = (regs[0] & 196) | (regs[1] & 40) | (bytetemp & 1);
	break;case 32:
	
	if (!(regs[0] & 64)) {
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[12] += (offset & 0x80 ? offset - 0x100 : offset);
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++; /* skip past offset byte */
}
	break;case 33:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
regPairs[8] = (h<<8) | l;
	break;case 34:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regPairs[8] & 0xff);;
addr = (addr + 1) & 0xffff;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regPairs[8] >> 8);;
	break;case 35:
	
	regPairs[8]++;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 36:
	
	

regs[0] = (regs[0] & 1) | (regs[17] & 0x0f ? 0 : 16) | 2;
regs[17] = (regs[17] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[17] == 0x80 ? 4 : 0 ) | ( regs[17] & 0x0f ? 0 : 16 ) | sz53Table[regs[17]];
	break;case 37:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[17] & 0x0f ? 0 : 16 ) | 2;
regs[17] = (regs[17] - 1) ;


regs[0] |= (regs[17] == 0x7f ? 4 : 0) | sz53Table[regs[17]];
	break;case 38:
	
	regs[17] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 39:
	
	var add = 0;
var carry = regs[0] & 1;
if( ( regs[0] & 16 ) || ( ( regs[1] & 0x0f ) > 9 ) ) add = 6;
if( carry || ( regs[1] > 0x99 ) ) add |= 0x60;
if( regs[1] > 0x99 ) carry = 1;
if( regs[0] & 2 ) {
	
var subtemp = regs[1] - add;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (add & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
} else {
	

var addtemp = regs[1] + add;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (add & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
}
regs[0] = ( regs[0] & -6 ) | carry | parityTable[regs[1]];
	break;case 40:
	
	if (regs[0] & 64) {
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[12] += (offset & 0x80 ? offset - 0x100 : offset);
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++; /* skip past offset byte */
}
	break;case 41:
	
	var add16temp = regPairs[8] + regPairs[8];
var lookup = ( (regPairs[8] & 0x0800) >> 11 ) | ( (regPairs[8] & 0x0800) >> 10 ) | ( (add16temp & 0x0800) >>  9 );
regPairs[8] = add16temp;
regs[0] = ( regs[0] & ( 196 ) ) | ( add16temp & 0x10000 ? 1 : 0 ) | ( ( add16temp >> 8 ) & ( 40 ) ) | halfcarryAddTable[lookup];
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 42:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
l = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
addr = (addr + 1) & 0xffff;
h = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regPairs[8] = (h<<8) | l;
	break;case 43:
	
	regPairs[8]--;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 44:
	
	

regs[0] = (regs[0] & 1) | (regs[16] & 0x0f ? 0 : 16) | 2;
regs[16] = (regs[16] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[16] == 0x80 ? 4 : 0 ) | ( regs[16] & 0x0f ? 0 : 16 ) | sz53Table[regs[16]];
	break;case 45:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[16] & 0x0f ? 0 : 16 ) | 2;
regs[16] = (regs[16] - 1) ;


regs[0] |= (regs[16] == 0x7f ? 4 : 0) | sz53Table[regs[16]];
	break;case 46:
	
	regs[16] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 47:
	
	regs[1] ^= 0xff;
regs[0] = (regs[0] & 197) | (regs[1] & 40) | 18;
	break;case 48:
	
	if (!(regs[0] & 1)) {
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[12] += (offset & 0x80 ? offset - 0x100 : offset);
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++; /* skip past offset byte */
}
	break;case 49:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
regPairs[11] = (h<<8) | l;
	break;case 50:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 51:
	
	regPairs[11]++;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 52:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = (regs[0] & 1) | (val & 0x0f ? 0 : 16) | 2;
val = (val + 1) & 0xff;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
regs[0] = (regs[0] & 1) | ( val == 0x80 ? 4 : 0 ) | ( val & 0x0f ? 0 : 16 ) | sz53Table[val];
	break;case 53:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = (regs[0] & 1 ) | ( val & 0x0f ? 0 : 16 ) | 2;
val = (val - 1) & 0xff;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
regs[0] |= (val == 0x7f ? 4 : 0) | sz53Table[val];
	break;case 54:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[8] + offset) & 0xffff;

var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 55:
	
	regs[0] = (regs[0] & 196) | (regs[1] & 40) | 1;
	break;case 56:
	
	if (regs[0] & 1) {
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[12] += (offset & 0x80 ? offset - 0x100 : offset);
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++; /* skip past offset byte */
}
	break;case 57:
	
	var add16temp = regPairs[8] + regPairs[11];
var lookup = ( (regPairs[8] & 0x0800) >> 11 ) | ( (regPairs[11] & 0x0800) >> 10 ) | ( (add16temp & 0x0800) >>  9 );
regPairs[8] = add16temp;
regs[0] = ( regs[0] & ( 196 ) ) | ( add16temp & 0x10000 ? 1 : 0 ) | ( ( add16temp >> 8 ) & ( 40 ) ) | halfcarryAddTable[lookup];
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 58:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
	break;case 59:
	
	regPairs[11]--;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 60:
	
	

regs[0] = (regs[0] & 1) | (regs[1] & 0x0f ? 0 : 16) | 2;
regs[1] = (regs[1] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[1] == 0x80 ? 4 : 0 ) | ( regs[1] & 0x0f ? 0 : 16 ) | sz53Table[regs[1]];
	break;case 61:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[1] & 0x0f ? 0 : 16 ) | 2;
regs[1] = (regs[1] - 1) ;


regs[0] |= (regs[1] == 0x7f ? 4 : 0) | sz53Table[regs[1]];
	break;case 62:
	
	regs[1] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 63:
	
	regs[0] = ( regs[0] & 196 ) | ( (regs[0] & 1) ? 16 : 1 ) | ( regs[1] & 40 );
	break;case 64:
	
	regs[3] = regs[3];
	break;case 65:
	
	regs[3] = regs[2];
	break;case 66:
	
	regs[3] = regs[5];
	break;case 67:
	
	regs[3] = regs[4];
	break;case 68:
	
	regs[3] = regs[17];
	break;case 69:
	
	regs[3] = regs[16];
	break;case 70:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[8] + offset) & 0xffff;

regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
	break;case 71:
	
	regs[3] = regs[1];
	break;case 72:
	
	regs[2] = regs[3];
	break;case 73:
	
	regs[2] = regs[2];
	break;case 74:
	
	regs[2] = regs[5];
	break;case 75:
	
	regs[2] = regs[4];
	break;case 76:
	
	regs[2] = regs[17];
	break;case 77:
	
	regs[2] = regs[16];
	break;case 78:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[8] + offset) & 0xffff;

regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
	break;case 79:
	
	regs[2] = regs[1];
	break;case 80:
	
	regs[5] = regs[3];
	break;case 81:
	
	regs[5] = regs[2];
	break;case 82:
	
	regs[5] = regs[5];
	break;case 83:
	
	regs[5] = regs[4];
	break;case 84:
	
	regs[5] = regs[17];
	break;case 85:
	
	regs[5] = regs[16];
	break;case 86:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[8] + offset) & 0xffff;

regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
	break;case 87:
	
	regs[5] = regs[1];
	break;case 88:
	
	regs[4] = regs[3];
	break;case 89:
	
	regs[4] = regs[2];
	break;case 90:
	
	regs[4] = regs[5];
	break;case 91:
	
	regs[4] = regs[4];
	break;case 92:
	
	regs[4] = regs[17];
	break;case 93:
	
	regs[4] = regs[16];
	break;case 94:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[8] + offset) & 0xffff;

regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
	break;case 95:
	
	regs[4] = regs[1];
	break;case 96:
	
	regs[17] = regs[3];
	break;case 97:
	
	regs[17] = regs[2];
	break;case 98:
	
	regs[17] = regs[5];
	break;case 99:
	
	regs[17] = regs[4];
	break;case 100:
	
	regs[17] = regs[17];
	break;case 101:
	
	regs[17] = regs[16];
	break;case 102:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[8] + offset) & 0xffff;

regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
	break;case 103:
	
	regs[17] = regs[1];
	break;case 104:
	
	regs[16] = regs[3];
	break;case 105:
	
	regs[16] = regs[2];
	break;case 106:
	
	regs[16] = regs[5];
	break;case 107:
	
	regs[16] = regs[4];
	break;case 108:
	
	regs[16] = regs[17];
	break;case 109:
	
	regs[16] = regs[16];
	break;case 110:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[8] + offset) & 0xffff;

regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
	break;case 111:
	
	regs[16] = regs[1];
	break;case 112:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[8] + offset) & 0xffff;

(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 113:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[8] + offset) & 0xffff;

(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 114:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[8] + offset) & 0xffff;

(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 115:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[8] + offset) & 0xffff;

(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 116:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[8] + offset) & 0xffff;

(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 117:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[8] + offset) & 0xffff;

(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 118:
	
	halted = true;
regPairs[12]--;
	break;case 119:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[8] + offset) & 0xffff;

(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 120:
	
	regs[1] = regs[3];
	break;case 121:
	
	regs[1] = regs[2];
	break;case 122:
	
	regs[1] = regs[5];
	break;case 123:
	
	regs[1] = regs[4];
	break;case 124:
	
	regs[1] = regs[17];
	break;case 125:
	
	regs[1] = regs[16];
	break;case 126:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[8] + offset) & 0xffff;

regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
	break;case 127:
	
	regs[1] = regs[1];
	break;case 128:
	
	

var addtemp = regs[1] + regs[3];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[3] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 129:
	
	

var addtemp = regs[1] + regs[2];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[2] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 130:
	
	

var addtemp = regs[1] + regs[5];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[5] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 131:
	
	

var addtemp = regs[1] + regs[4];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[4] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 132:
	
	

var addtemp = regs[1] + regs[17];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[17] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 133:
	
	

var addtemp = regs[1] + regs[16];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[16] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 134:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var addtemp = regs[1] + val;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 135:
	
	

var addtemp = regs[1] + regs[1];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[1] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 136:
	
	

var adctemp = regs[1] + regs[3] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[3] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 137:
	
	

var adctemp = regs[1] + regs[2] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[2] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 138:
	
	

var adctemp = regs[1] + regs[5] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[5] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 139:
	
	

var adctemp = regs[1] + regs[4] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[4] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 140:
	
	

var adctemp = regs[1] + regs[17] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[17] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 141:
	
	

var adctemp = regs[1] + regs[16] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[16] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 142:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var adctemp = regs[1] + val + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 143:
	
	

var adctemp = regs[1] + regs[1] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[1] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 144:
	
	
var subtemp = regs[1] - regs[3];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[3] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 145:
	
	
var subtemp = regs[1] - regs[2];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[2] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 146:
	
	
var subtemp = regs[1] - regs[5];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[5] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 147:
	
	
var subtemp = regs[1] - regs[4];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[4] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 148:
	
	
var subtemp = regs[1] - regs[17];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[17] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 149:
	
	
var subtemp = regs[1] - regs[16];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[16] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 150:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
var subtemp = regs[1] - val;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 151:
	
	
var subtemp = regs[1] - regs[1];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[1] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 152:
	
	
var sbctemp = regs[1] - regs[3] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[3] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 153:
	
	
var sbctemp = regs[1] - regs[2] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[2] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 154:
	
	
var sbctemp = regs[1] - regs[5] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[5] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 155:
	
	
var sbctemp = regs[1] - regs[4] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[4] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 156:
	
	
var sbctemp = regs[1] - regs[17] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[17] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 157:
	
	
var sbctemp = regs[1] - regs[16] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[16] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 158:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
var sbctemp = regs[1] - val - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 159:
	
	
var sbctemp = regs[1] - regs[1] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[1] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 160:
	
	

regs[1] &= regs[3];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 161:
	
	

regs[1] &= regs[2];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 162:
	
	

regs[1] &= regs[5];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 163:
	
	

regs[1] &= regs[4];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 164:
	
	

regs[1] &= regs[17];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 165:
	
	

regs[1] &= regs[16];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 166:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] &= val;
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 167:
	
	

regs[1] &= regs[1];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 168:
	
	
regs[1] ^= regs[3];
regs[0] = sz53pTable[regs[1]];
	break;case 169:
	
	
regs[1] ^= regs[2];
regs[0] = sz53pTable[regs[1]];
	break;case 170:
	
	
regs[1] ^= regs[5];
regs[0] = sz53pTable[regs[1]];
	break;case 171:
	
	
regs[1] ^= regs[4];
regs[0] = sz53pTable[regs[1]];
	break;case 172:
	
	
regs[1] ^= regs[17];
regs[0] = sz53pTable[regs[1]];
	break;case 173:
	
	
regs[1] ^= regs[16];
regs[0] = sz53pTable[regs[1]];
	break;case 174:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[1] ^= val;
regs[0] = sz53pTable[regs[1]];
	break;case 175:
	
	
regs[1] ^= regs[1];
regs[0] = sz53pTable[regs[1]];
	break;case 176:
	
	

regs[1] |= regs[3];
regs[0] = sz53pTable[regs[1]];
	break;case 177:
	
	

regs[1] |= regs[2];
regs[0] = sz53pTable[regs[1]];
	break;case 178:
	
	

regs[1] |= regs[5];
regs[0] = sz53pTable[regs[1]];
	break;case 179:
	
	

regs[1] |= regs[4];
regs[0] = sz53pTable[regs[1]];
	break;case 180:
	
	

regs[1] |= regs[17];
regs[0] = sz53pTable[regs[1]];
	break;case 181:
	
	

regs[1] |= regs[16];
regs[0] = sz53pTable[regs[1]];
	break;case 182:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] |= val;
regs[0] = sz53pTable[regs[1]];
	break;case 183:
	
	

regs[1] |= regs[1];
regs[0] = sz53pTable[regs[1]];
	break;case 184:
	
	

var cptemp = regs[1] - regs[3];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[3] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[3] & 40 ) | ( cptemp & 128 );
	break;case 185:
	
	

var cptemp = regs[1] - regs[2];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[2] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[2] & 40 ) | ( cptemp & 128 );
	break;case 186:
	
	

var cptemp = regs[1] - regs[5];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[5] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[5] & 40 ) | ( cptemp & 128 );
	break;case 187:
	
	

var cptemp = regs[1] - regs[4];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[4] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[4] & 40 ) | ( cptemp & 128 );
	break;case 188:
	
	

var cptemp = regs[1] - regs[17];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[17] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[17] & 40 ) | ( cptemp & 128 );
	break;case 189:
	
	

var cptemp = regs[1] - regs[16];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[16] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[16] & 40 ) | ( cptemp & 128 );
	break;case 190:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var cptemp = regs[1] - val;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( val & 40 ) | ( cptemp & 128 );
	break;case 191:
	
	

var cptemp = regs[1] - regs[1];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[1] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[1] & 40 ) | ( cptemp & 128 );
	break;case 192:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (!(regs[0] & 64)) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 193:
	
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
regPairs[1] = (h<<8) | l;
	break;case 194:
	
	if (!(regs[0] & 64)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 195:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
regPairs[12] = (h<<8) | l;
	break;case 196:
	
	if (!(regs[0] & 64)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 197:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[1] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[1] & 0xff);;
	break;case 198:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;

var addtemp = regs[1] + val;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 199:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 0;
	break;case 200:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (regs[0] & 64) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 201:
	
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++; 
regPairs[12] = (h<<8) | l;
	break;case 202:
	
	if (regs[0] & 64) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 203:
	
	opcodePrefix = 'DDCB';
interruptible = false;
	break;case 204:
	
	if (regs[0] & 64) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 205:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = (h<<8) | l;
	break;case 206:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;

var adctemp = regs[1] + val + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 207:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 8;
	break;case 208:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (!(regs[0] & 1)) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 209:
	
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
regPairs[2] = (h<<8) | l;
	break;case 210:
	
	if (!(regs[0] & 1)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 211:
	
	var port = (regs[1] << 8) | ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var isContendedMemory = memory.isContended(port);
var isULAPort = ioBus.isULAPort(port);
if (isContendedMemory) tstates += ioBus.contend(port, tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
ioBus.write(port, regs[1], tstates);
if (isContendedMemory || isULAPort) {
	ioBus.contend(port);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(port); tstates += 1;
		ioBus.contend(port); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
	break;case 212:
	
	if (!(regs[0] & 1)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 213:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[2] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[2] & 0xff);;
	break;case 214:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var subtemp = regs[1] - val;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 215:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 16;
	break;case 216:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (regs[0] & 1) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 217:
	
	var wordtemp;
wordtemp = regPairs[1]; regPairs[1] = regPairs[5]; regPairs[5] = wordtemp;
wordtemp = regPairs[2]; regPairs[2] = regPairs[6]; regPairs[6] = wordtemp;
wordtemp = regPairs[3]; regPairs[3] = regPairs[7]; regPairs[7] = wordtemp;
	break;case 218:
	
	if (regs[0] & 1) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 219:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var port = (regs[1] << 8) | val;
var isContendedMemory = memory.isContended(port);
var isULAPort = ioBus.isULAPort(port);
if (isContendedMemory) tstates += ioBus.contend(port, tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
regs[1] = ioBus.read(port);
if (isContendedMemory || isULAPort) {
	ioBus.contend(port);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(port); tstates += 1;
		ioBus.contend(port); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
	break;case 220:
	
	if (regs[0] & 1) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 221:
	
	opcodePrefix = 'DD';
interruptible = false;
	break;case 222:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var sbctemp = regs[1] - val - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 223:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 24;
	break;case 224:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (!(regs[0] & 4)) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 225:
	
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
regPairs[8] = (h<<8) | l;
	break;case 226:
	
	if (!(regs[0] & 4)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 227:
	
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11]));
var spPlus1 = (regPairs[11] + 1) & 0xffff;
var h = ((tstates += memory.contend(spPlus1, tstates) + ( 3)), memory.read(spPlus1));
(tstates += memory.contend(spPlus1, tstates) + ( 1));
(tstates += memory.contend(spPlus1, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(spPlus1, regPairs[8] >> 8);;
(tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[8] & 0xff);;
regPairs[8] = (h<<8) | l;
(tstates += memory.contend(regPairs[11], tstates) + ( 1));
(tstates += memory.contend(regPairs[11], tstates) + ( 1));
	break;case 228:
	
	if (!(regs[0] & 4)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 229:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[8] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[8] & 0xff);;
	break;case 230:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;

regs[1] &= val;
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 231:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 32;
	break;case 232:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (regs[0] & 4) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 233:
	
	regPairs[12] = regPairs[8];
	break;case 234:
	
	if (regs[0] & 4) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 235:
	
	var temp = regPairs[2];
regPairs[2] = regPairs[3];
regPairs[3] = temp;
	break;case 236:
	
	if (regs[0] & 4) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 237:
	
	opcodePrefix = 'ED';
interruptible = false;
	break;case 238:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
regs[1] ^= val;
regs[0] = sz53pTable[regs[1]];
	break;case 239:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 40;
	break;case 240:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (!(regs[0] & 128)) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 241:
	
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
regPairs[0] = (h<<8) | l;
	break;case 242:
	
	if (!(regs[0] & 128)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 243:
	
	iff1 = iff2 = 0;
	break;case 244:
	
	if (!(regs[0] & 128)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 245:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[0] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[0] & 0xff);;
	break;case 246:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;

regs[1] |= val;
regs[0] = sz53pTable[regs[1]];
	break;case 247:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 48;
	break;case 248:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (regs[0] & 128) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 249:
	
	regPairs[11] = regPairs[8];
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 250:
	
	if (regs[0] & 128) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 251:
	
	iff1 = iff2 = 1;
interruptible = false;
	break;case 252:
	
	if (regs[0] & 128) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 253:
	
	opcodePrefix = 'FD';
interruptible = false;
	break;case 254:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;

var cptemp = regs[1] - val;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( val & 40 ) | ( cptemp & 128 );
	break;case 255:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 56;
	break;
	default:
		var addr = regPairs[12] - 1;
		throw("Unimplemented opcode " + opcode + " in page dd - PC = " + addr);
}
					break;
				case 'DDCB':
					offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
					if (offset & 0x80) offset -= 0x100;
					(tstates += memory.contend(regPairs[12], tstates) + ( 3));
					opcode = memory.read(regPairs[12]);
					(tstates += memory.contend(regPairs[12], tstates) + ( 1));
					(tstates += memory.contend(regPairs[12], tstates) + ( 1));
					regPairs[12]++;
					switch (opcode) {
	case 0:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] = ( (regs[3] << 1) | (regs[3] >> 7) ) ;
regs[0] = (regs[3] & 1) | sz53pTable[regs[3]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 1:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] = ( (regs[2] << 1) | (regs[2] >> 7) ) ;
regs[0] = (regs[2] & 1) | sz53pTable[regs[2]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 2:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] = ( (regs[5] << 1) | (regs[5] >> 7) ) ;
regs[0] = (regs[5] & 1) | sz53pTable[regs[5]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 3:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] = ( (regs[4] << 1) | (regs[4] >> 7) ) ;
regs[0] = (regs[4] & 1) | sz53pTable[regs[4]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 4:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] = ( (regs[7] << 1) | (regs[7] >> 7) ) ;
regs[0] = (regs[7] & 1) | sz53pTable[regs[7]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 5:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] = ( (regs[6] << 1) | (regs[6] >> 7) ) ;
regs[0] = (regs[6] & 1) | sz53pTable[regs[6]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 6:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val = ( (val << 1) | (val >> 7) ) & 0xff;
regs[0] = (val & 1) | sz53pTable[val];
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 7:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] = ( (regs[1] << 1) | (regs[1] >> 7) ) ;
regs[0] = (regs[1] & 1) | sz53pTable[regs[1]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 8:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[3] & 1;
regs[3] = ( (regs[3] >> 1) | (regs[3] << 7) ) ;
regs[0] |= sz53pTable[regs[3]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 9:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[2] & 1;
regs[2] = ( (regs[2] >> 1) | (regs[2] << 7) ) ;
regs[0] |= sz53pTable[regs[2]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 10:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[5] & 1;
regs[5] = ( (regs[5] >> 1) | (regs[5] << 7) ) ;
regs[0] |= sz53pTable[regs[5]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 11:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[4] & 1;
regs[4] = ( (regs[4] >> 1) | (regs[4] << 7) ) ;
regs[0] |= sz53pTable[regs[4]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 12:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[7] & 1;
regs[7] = ( (regs[7] >> 1) | (regs[7] << 7) ) ;
regs[0] |= sz53pTable[regs[7]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 13:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[6] & 1;
regs[6] = ( (regs[6] >> 1) | (regs[6] << 7) ) ;
regs[0] |= sz53pTable[regs[6]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 14:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = val & 1;
val = ( (val >> 1) | (val << 7) ) & 0xff;
regs[0] |= sz53pTable[val];
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 15:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[1] & 1;
regs[1] = ( (regs[1] >> 1) | (regs[1] << 7) ) ;
regs[0] |= sz53pTable[regs[1]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 16:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rltemp = regs[3];
regs[3] = ( (regs[3] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[3]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 17:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rltemp = regs[2];
regs[2] = ( (regs[2] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[2]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 18:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rltemp = regs[5];
regs[5] = ( (regs[5] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[5]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 19:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rltemp = regs[4];
regs[4] = ( (regs[4] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[4]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 20:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rltemp = regs[7];
regs[7] = ( (regs[7] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[7]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 21:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rltemp = regs[6];
regs[6] = ( (regs[6] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[6]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 22:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
var rltemp = val;
val = ( (val << 1) | (regs[0] & 1) ) & 0xff;
regs[0] = ( rltemp >> 7 ) | sz53pTable[val];
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 23:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rltemp = regs[1];
regs[1] = ( (regs[1] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[1]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 24:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rrtemp = regs[3];
regs[3] = ( (regs[3] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[3]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 25:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rrtemp = regs[2];
regs[2] = ( (regs[2] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[2]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 26:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rrtemp = regs[5];
regs[5] = ( (regs[5] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[5]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 27:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rrtemp = regs[4];
regs[4] = ( (regs[4] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[4]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 28:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rrtemp = regs[7];
regs[7] = ( (regs[7] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[7]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 29:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rrtemp = regs[6];
regs[6] = ( (regs[6] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[6]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 30:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
var rrtemp = val;
val = ( (val >> 1) | ( regs[0] << 7 ) ) & 0xff;
regs[0] = (rrtemp & 1) | sz53pTable[val];
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 31:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rrtemp = regs[1];
regs[1] = ( (regs[1] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[1]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 32:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[3] >> 7;
regs[3] = (regs[3] << 1) ;
regs[0] |= sz53pTable[regs[3]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 33:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[2] >> 7;
regs[2] = (regs[2] << 1) ;
regs[0] |= sz53pTable[regs[2]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 34:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[5] >> 7;
regs[5] = (regs[5] << 1) ;
regs[0] |= sz53pTable[regs[5]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 35:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[4] >> 7;
regs[4] = (regs[4] << 1) ;
regs[0] |= sz53pTable[regs[4]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 36:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[7] >> 7;
regs[7] = (regs[7] << 1) ;
regs[0] |= sz53pTable[regs[7]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 37:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[6] >> 7;
regs[6] = (regs[6] << 1) ;
regs[0] |= sz53pTable[regs[6]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 38:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = val >> 7;
val = (val << 1) & 0xff;
regs[0] |= sz53pTable[val];
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 39:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[1] >> 7;
regs[1] = (regs[1] << 1) ;
regs[0] |= sz53pTable[regs[1]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 40:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[3] & 1;
regs[3] = ( (regs[3] & 0x80) | (regs[3] >> 1) ) ;
regs[0] |= sz53pTable[regs[3]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 41:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[2] & 1;
regs[2] = ( (regs[2] & 0x80) | (regs[2] >> 1) ) ;
regs[0] |= sz53pTable[regs[2]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 42:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[5] & 1;
regs[5] = ( (regs[5] & 0x80) | (regs[5] >> 1) ) ;
regs[0] |= sz53pTable[regs[5]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 43:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[4] & 1;
regs[4] = ( (regs[4] & 0x80) | (regs[4] >> 1) ) ;
regs[0] |= sz53pTable[regs[4]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 44:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[7] & 1;
regs[7] = ( (regs[7] & 0x80) | (regs[7] >> 1) ) ;
regs[0] |= sz53pTable[regs[7]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 45:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[6] & 1;
regs[6] = ( (regs[6] & 0x80) | (regs[6] >> 1) ) ;
regs[0] |= sz53pTable[regs[6]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 46:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = val & 1;
val = ( (val & 0x80) | (val >> 1) ) & 0xff;
regs[0] |= sz53pTable[val];
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 47:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[1] & 1;
regs[1] = ( (regs[1] & 0x80) | (regs[1] >> 1) ) ;
regs[0] |= sz53pTable[regs[1]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 48:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[3] >> 7;
regs[3] = (((regs[3]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[3]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 49:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[2] >> 7;
regs[2] = (((regs[2]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[2]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 50:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[5] >> 7;
regs[5] = (((regs[5]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[5]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 51:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[4] >> 7;
regs[4] = (((regs[4]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[4]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 52:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[7] >> 7;
regs[7] = (((regs[7]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[7]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 53:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[6] >> 7;
regs[6] = (((regs[6]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[6]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 54:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] =  val >> 7;
val = (((val) << 1) & 0xff) | 0x01;
regs[0] |= sz53pTable[val];
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 55:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[1] >> 7;
regs[1] = (((regs[1]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[1]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 56:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[3] & 1;
regs[3] >>= 1;
regs[0] |= sz53pTable[regs[3]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 57:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[2] & 1;
regs[2] >>= 1;
regs[0] |= sz53pTable[regs[2]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 58:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[5] & 1;
regs[5] >>= 1;
regs[0] |= sz53pTable[regs[5]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 59:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[4] & 1;
regs[4] >>= 1;
regs[0] |= sz53pTable[regs[4]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 60:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[7] & 1;
regs[7] >>= 1;
regs[0] |= sz53pTable[regs[7]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 61:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[6] & 1;
regs[6] >>= 1;
regs[0] |= sz53pTable[regs[6]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 62:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] =  val & 1;
val >>= 1;
regs[0] |= sz53pTable[val];
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 63:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[1] & 1;
regs[1] >>= 1;
regs[0] |= sz53pTable[regs[1]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 64:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 1) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 65:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 1) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 66:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 1) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 67:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 1) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 68:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 1) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 69:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 1) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 70:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 1) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 71:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 1) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 72:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 2) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 73:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 2) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 74:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 2) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 75:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 2) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 76:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 2) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 77:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 2) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 78:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 2) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 79:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 2) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 80:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 4) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 81:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 4) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 82:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 4) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 83:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 4) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 84:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 4) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 85:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 4) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 86:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 4) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 87:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 4) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 88:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 8) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 89:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 8) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 90:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 8) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 91:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 8) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 92:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 8) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 93:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 8) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 94:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 8) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 95:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 8) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 96:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 16) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 97:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 16) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 98:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 16) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 99:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 16) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 100:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 16) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 101:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 16) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 102:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 16) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 103:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 16) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 104:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 32) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 105:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 32) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 106:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 32) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 107:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 32) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 108:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 32) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 109:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 32) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 110:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 32) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 111:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 32) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 112:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 64) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 113:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 64) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 114:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 64) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 115:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 64) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 116:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 64) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 117:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 64) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 118:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 64) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 119:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 64) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 120:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 128) ) regs[0] |= 68;
if (value & 0x80) regs[0] |= 128;
(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 121:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 128) ) regs[0] |= 68;
if (value & 0x80) regs[0] |= 128;
(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 122:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 128) ) regs[0] |= 68;
if (value & 0x80) regs[0] |= 128;
(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 123:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 128) ) regs[0] |= 68;
if (value & 0x80) regs[0] |= 128;
(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 124:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 128) ) regs[0] |= 68;
if (value & 0x80) regs[0] |= 128;
(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 125:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 128) ) regs[0] |= 68;
if (value & 0x80) regs[0] |= 128;
(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 126:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 128) ) regs[0] |= 68;
if (value & 0x80) regs[0] |= 128;
(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 127:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 128) ) regs[0] |= 68;
if (value & 0x80) regs[0] |= 128;
(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 128:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] &= 254;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 129:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] &= 254;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 130:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] &= 254;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 131:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] &= 254;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 132:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] &= 254;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 133:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] &= 254;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 134:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val &= 254;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 135:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] &= 254;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 136:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] &= 253;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 137:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] &= 253;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 138:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] &= 253;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 139:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] &= 253;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 140:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] &= 253;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 141:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] &= 253;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 142:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val &= 253;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 143:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] &= 253;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 144:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] &= 251;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 145:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] &= 251;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 146:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] &= 251;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 147:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] &= 251;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 148:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] &= 251;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 149:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] &= 251;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 150:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val &= 251;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 151:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] &= 251;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 152:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] &= 247;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 153:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] &= 247;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 154:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] &= 247;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 155:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] &= 247;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 156:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] &= 247;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 157:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] &= 247;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 158:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val &= 247;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 159:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] &= 247;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 160:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] &= 239;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 161:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] &= 239;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 162:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] &= 239;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 163:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] &= 239;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 164:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] &= 239;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 165:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] &= 239;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 166:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val &= 239;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 167:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] &= 239;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 168:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] &= 223;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 169:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] &= 223;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 170:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] &= 223;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 171:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] &= 223;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 172:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] &= 223;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 173:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] &= 223;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 174:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val &= 223;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 175:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] &= 223;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 176:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] &= 191;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 177:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] &= 191;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 178:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] &= 191;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 179:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] &= 191;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 180:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] &= 191;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 181:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] &= 191;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 182:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val &= 191;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 183:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] &= 191;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 184:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] &= 127;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 185:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] &= 127;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 186:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] &= 127;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 187:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] &= 127;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 188:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] &= 127;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 189:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] &= 127;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 190:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val &= 127;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 191:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] &= 127;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 192:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] |= 1;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 193:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] |= 1;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 194:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] |= 1;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 195:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] |= 1;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 196:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] |= 1;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 197:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] |= 1;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 198:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val |= 1;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 199:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] |= 1;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 200:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] |= 2;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 201:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] |= 2;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 202:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] |= 2;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 203:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] |= 2;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 204:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] |= 2;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 205:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] |= 2;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 206:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val |= 2;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 207:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] |= 2;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 208:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] |= 4;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 209:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] |= 4;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 210:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] |= 4;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 211:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] |= 4;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 212:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] |= 4;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 213:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] |= 4;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 214:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val |= 4;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 215:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] |= 4;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 216:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] |= 8;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 217:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] |= 8;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 218:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] |= 8;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 219:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] |= 8;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 220:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] |= 8;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 221:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] |= 8;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 222:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val |= 8;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 223:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] |= 8;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 224:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] |= 16;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 225:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] |= 16;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 226:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] |= 16;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 227:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] |= 16;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 228:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] |= 16;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 229:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] |= 16;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 230:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val |= 16;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 231:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] |= 16;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 232:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] |= 32;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 233:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] |= 32;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 234:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] |= 32;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 235:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] |= 32;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 236:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] |= 32;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 237:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] |= 32;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 238:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val |= 32;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 239:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] |= 32;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 240:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] |= 64;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 241:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] |= 64;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 242:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] |= 64;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 243:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] |= 64;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 244:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] |= 64;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 245:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] |= 64;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 246:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val |= 64;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 247:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] |= 64;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 248:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] |= 128;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 249:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] |= 128;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 250:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] |= 128;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 251:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] |= 128;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 252:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] |= 128;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 253:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] |= 128;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 254:
	
	var addr = (regPairs[8] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val |= 128;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 255:
	
	var addr = (regPairs[8] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] |= 128;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;
	default:
		var addr = regPairs[12] - 1;
		throw("Unimplemented opcode " + opcode + " in page ddcb - PC = " + addr);
}
					break;
				case 'ED':
					(tstates += memory.contend(regPairs[12], tstates) + ( 4));
					opcode = memory.read(regPairs[12]); regPairs[12]++;
					regs[20] = ((regs[20] + 1) & 0x7f) | (regs[20] & 0x80);
					switch (opcode) {
	case 64:
	
	var port = regPairs[1];
var isContendedMemory = memory.isContended(port);
var isULAPort = ioBus.isULAPort(port);
if (isContendedMemory) tstates += ioBus.contend(port, tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
regs[3] = ioBus.read(port);
if (isContendedMemory || isULAPort) {
	ioBus.contend(port);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(port); tstates += 1;
		ioBus.contend(port); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
regs[0] = (regs[0] & 1) | sz53pTable[regs[3]];
	break;case 65:
	
	var isContendedMemory = memory.isContended(regPairs[1]);
var isULAPort = ioBus.isULAPort(regPairs[1]);
if (isContendedMemory) tstates += ioBus.contend(regPairs[1], tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
ioBus.write(regPairs[1], regs[3], tstates);
if (isContendedMemory || isULAPort) {
	ioBus.contend(regPairs[1]);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(regPairs[1]); tstates += 1;
		ioBus.contend(regPairs[1]); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
	break;case 66:
	
	var sub16temp = regPairs[3] - regPairs[1] - (regs[0] & 1);
var lookup = ( (regPairs[3] & 0x8800) >> 11 ) | ( (regPairs[1] & 0x8800) >> 10 ) | ( (sub16temp & 0x8800) >>  9 );
regPairs[3] = sub16temp;
regs[0] = ( sub16temp & 0x10000 ? 1 : 0 ) | 2 | overflowSubTable[lookup >> 4] | (regs[7] & 168) | halfcarrySubTable[lookup&0x07] | (regPairs[3] ? 0 : 64);
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 67:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regPairs[1] & 0xff);;
addr = (addr + 1) & 0xffff;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regPairs[1] >> 8);;
	break;case 68:
	
	var val = regs[1];
var subtemp = -val;
var lookup = ( (val & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 69:
	
	iff1 = iff2;
var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++; 
regPairs[12] = (h<<8) | l;
	break;case 70:
	
	im = 0;
	break;case 71:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regs[21] = regs[1];
	break;case 72:
	
	var port = regPairs[1];
var isContendedMemory = memory.isContended(port);
var isULAPort = ioBus.isULAPort(port);
if (isContendedMemory) tstates += ioBus.contend(port, tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
regs[2] = ioBus.read(port);
if (isContendedMemory || isULAPort) {
	ioBus.contend(port);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(port); tstates += 1;
		ioBus.contend(port); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
regs[0] = (regs[0] & 1) | sz53pTable[regs[2]];
	break;case 73:
	
	var isContendedMemory = memory.isContended(regPairs[1]);
var isULAPort = ioBus.isULAPort(regPairs[1]);
if (isContendedMemory) tstates += ioBus.contend(regPairs[1], tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
ioBus.write(regPairs[1], regs[2], tstates);
if (isContendedMemory || isULAPort) {
	ioBus.contend(regPairs[1]);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(regPairs[1]); tstates += 1;
		ioBus.contend(regPairs[1]); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
	break;case 74:
	
	var add16temp = regPairs[3] + regPairs[1] + (regs[0] & 1);
var lookup = (
	( (regPairs[3] & 0x8800) >> 11 ) |
	( (regPairs[1] & 0x8800) >> 10 ) |
	( (add16temp & 0x8800) >>  9 )
);
regPairs[3] = add16temp;
regs[0] = (
	(add16temp & 0x10000 ? 1 : 0) |
	overflowAddTable[lookup >> 4] |
	(regs[7] & 168) |
	halfcarryAddTable[lookup & 0x07] |
	(regPairs[3] ? 0 : 64)
);
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 75:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
l = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
addr = (addr + 1) & 0xffff;
h = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regPairs[1] = (h<<8) | l;
	break;case 76:
	
	var val = regs[1];
var subtemp = -val;
var lookup = ( (val & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 77:
	
	iff1 = iff2;
var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++; 
regPairs[12] = (h<<8) | l;
	break;case 78:
	
	im = 0;
	break;case 79:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regs[20] = regs[1];
	break;case 80:
	
	var port = regPairs[1];
var isContendedMemory = memory.isContended(port);
var isULAPort = ioBus.isULAPort(port);
if (isContendedMemory) tstates += ioBus.contend(port, tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
regs[5] = ioBus.read(port);
if (isContendedMemory || isULAPort) {
	ioBus.contend(port);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(port); tstates += 1;
		ioBus.contend(port); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
regs[0] = (regs[0] & 1) | sz53pTable[regs[5]];
	break;case 81:
	
	var isContendedMemory = memory.isContended(regPairs[1]);
var isULAPort = ioBus.isULAPort(regPairs[1]);
if (isContendedMemory) tstates += ioBus.contend(regPairs[1], tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
ioBus.write(regPairs[1], regs[5], tstates);
if (isContendedMemory || isULAPort) {
	ioBus.contend(regPairs[1]);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(regPairs[1]); tstates += 1;
		ioBus.contend(regPairs[1]); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
	break;case 82:
	
	var sub16temp = regPairs[3] - regPairs[2] - (regs[0] & 1);
var lookup = ( (regPairs[3] & 0x8800) >> 11 ) | ( (regPairs[2] & 0x8800) >> 10 ) | ( (sub16temp & 0x8800) >>  9 );
regPairs[3] = sub16temp;
regs[0] = ( sub16temp & 0x10000 ? 1 : 0 ) | 2 | overflowSubTable[lookup >> 4] | (regs[7] & 168) | halfcarrySubTable[lookup&0x07] | (regPairs[3] ? 0 : 64);
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 83:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regPairs[2] & 0xff);;
addr = (addr + 1) & 0xffff;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regPairs[2] >> 8);;
	break;case 84:
	
	var val = regs[1];
var subtemp = -val;
var lookup = ( (val & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 85:
	
	iff1 = iff2;
var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++; 
regPairs[12] = (h<<8) | l;
	break;case 86:
	
	im = 1;
	break;case 87:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regs[1] = regs[21];regs[0] = (regs[0] & 1) | sz53Table[regs[1]] | ( iff2 ? 4 : 0 );
	break;case 88:
	
	var port = regPairs[1];
var isContendedMemory = memory.isContended(port);
var isULAPort = ioBus.isULAPort(port);
if (isContendedMemory) tstates += ioBus.contend(port, tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
regs[4] = ioBus.read(port);
if (isContendedMemory || isULAPort) {
	ioBus.contend(port);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(port); tstates += 1;
		ioBus.contend(port); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
regs[0] = (regs[0] & 1) | sz53pTable[regs[4]];
	break;case 89:
	
	var isContendedMemory = memory.isContended(regPairs[1]);
var isULAPort = ioBus.isULAPort(regPairs[1]);
if (isContendedMemory) tstates += ioBus.contend(regPairs[1], tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
ioBus.write(regPairs[1], regs[4], tstates);
if (isContendedMemory || isULAPort) {
	ioBus.contend(regPairs[1]);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(regPairs[1]); tstates += 1;
		ioBus.contend(regPairs[1]); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
	break;case 90:
	
	var add16temp = regPairs[3] + regPairs[2] + (regs[0] & 1);
var lookup = (
	( (regPairs[3] & 0x8800) >> 11 ) |
	( (regPairs[2] & 0x8800) >> 10 ) |
	( (add16temp & 0x8800) >>  9 )
);
regPairs[3] = add16temp;
regs[0] = (
	(add16temp & 0x10000 ? 1 : 0) |
	overflowAddTable[lookup >> 4] |
	(regs[7] & 168) |
	halfcarryAddTable[lookup & 0x07] |
	(regPairs[3] ? 0 : 64)
);
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 91:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
l = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
addr = (addr + 1) & 0xffff;
h = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regPairs[2] = (h<<8) | l;
	break;case 92:
	
	var val = regs[1];
var subtemp = -val;
var lookup = ( (val & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 93:
	
	iff1 = iff2;
var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++; 
regPairs[12] = (h<<8) | l;
	break;case 94:
	
	im = 2;
	break;case 95:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regs[1] = regs[20];regs[0] = (regs[0] & 1) | sz53Table[regs[1]] | ( iff2 ? 4 : 0 );
	break;case 96:
	
	var port = regPairs[1];
var isContendedMemory = memory.isContended(port);
var isULAPort = ioBus.isULAPort(port);
if (isContendedMemory) tstates += ioBus.contend(port, tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
regs[7] = ioBus.read(port);
if (isContendedMemory || isULAPort) {
	ioBus.contend(port);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(port); tstates += 1;
		ioBus.contend(port); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
regs[0] = (regs[0] & 1) | sz53pTable[regs[7]];
	break;case 97:
	
	var isContendedMemory = memory.isContended(regPairs[1]);
var isULAPort = ioBus.isULAPort(regPairs[1]);
if (isContendedMemory) tstates += ioBus.contend(regPairs[1], tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
ioBus.write(regPairs[1], regs[7], tstates);
if (isContendedMemory || isULAPort) {
	ioBus.contend(regPairs[1]);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(regPairs[1]); tstates += 1;
		ioBus.contend(regPairs[1]); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
	break;case 98:
	
	var sub16temp = regPairs[3] - regPairs[3] - (regs[0] & 1);
var lookup = ( (regPairs[3] & 0x8800) >> 11 ) | ( (regPairs[3] & 0x8800) >> 10 ) | ( (sub16temp & 0x8800) >>  9 );
regPairs[3] = sub16temp;
regs[0] = ( sub16temp & 0x10000 ? 1 : 0 ) | 2 | overflowSubTable[lookup >> 4] | (regs[7] & 168) | halfcarrySubTable[lookup&0x07] | (regPairs[3] ? 0 : 64);
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 99:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regPairs[3] & 0xff);;
addr = (addr + 1) & 0xffff;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regPairs[3] >> 8);;
	break;case 100:
	
	var val = regs[1];
var subtemp = -val;
var lookup = ( (val & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 101:
	
	iff1 = iff2;
var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++; 
regPairs[12] = (h<<8) | l;
	break;case 102:
	
	im = 0;
	break;case 103:
	
	var bytetemp = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
var val = (regs[1] << 4) | (bytetemp >> 4);
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
regs[1] = (regs[1] & 0xf0) | (bytetemp & 0x0f);
regs[0] = (regs[0] & 1) | sz53pTable[regs[1]];
	break;case 104:
	
	var port = regPairs[1];
var isContendedMemory = memory.isContended(port);
var isULAPort = ioBus.isULAPort(port);
if (isContendedMemory) tstates += ioBus.contend(port, tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
regs[6] = ioBus.read(port);
if (isContendedMemory || isULAPort) {
	ioBus.contend(port);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(port); tstates += 1;
		ioBus.contend(port); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
regs[0] = (regs[0] & 1) | sz53pTable[regs[6]];
	break;case 105:
	
	var isContendedMemory = memory.isContended(regPairs[1]);
var isULAPort = ioBus.isULAPort(regPairs[1]);
if (isContendedMemory) tstates += ioBus.contend(regPairs[1], tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
ioBus.write(regPairs[1], regs[6], tstates);
if (isContendedMemory || isULAPort) {
	ioBus.contend(regPairs[1]);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(regPairs[1]); tstates += 1;
		ioBus.contend(regPairs[1]); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
	break;case 106:
	
	var add16temp = regPairs[3] + regPairs[3] + (regs[0] & 1);
var lookup = (
	( (regPairs[3] & 0x8800) >> 11 ) |
	( (regPairs[3] & 0x8800) >> 10 ) |
	( (add16temp & 0x8800) >>  9 )
);
regPairs[3] = add16temp;
regs[0] = (
	(add16temp & 0x10000 ? 1 : 0) |
	overflowAddTable[lookup >> 4] |
	(regs[7] & 168) |
	halfcarryAddTable[lookup & 0x07] |
	(regPairs[3] ? 0 : 64)
);
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 107:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
l = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
addr = (addr + 1) & 0xffff;
h = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regPairs[3] = (h<<8) | l;
	break;case 108:
	
	var val = regs[1];
var subtemp = -val;
var lookup = ( (val & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 109:
	
	iff1 = iff2;
var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++; 
regPairs[12] = (h<<8) | l;
	break;case 110:
	
	im = 0;
	break;case 111:
	
	var bytetemp =  ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
(tstates += memory.contend(regPairs[3], tstates) + ( 1));
var val = (bytetemp << 4) | (regs[1] & 0x0f);
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], val);;
regs[1] = (regs[1] & 0xf0) | (bytetemp >> 4);
regs[0] = (regs[0] & 1) | sz53pTable[regs[1]];
	break;case 112:
	
	var port = regPairs[1];
var isContendedMemory = memory.isContended(port);
var isULAPort = ioBus.isULAPort(port);
if (isContendedMemory) tstates += ioBus.contend(port, tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
var result = ioBus.read(port);
if (isContendedMemory || isULAPort) {
	ioBus.contend(port);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(port); tstates += 1;
		ioBus.contend(port); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
regs[0] = (regs[0] & 1) | sz53pTable[result];
	break;case 113:
	
	var isContendedMemory = memory.isContended(regPairs[1]);
var isULAPort = ioBus.isULAPort(regPairs[1]);
if (isContendedMemory) tstates += ioBus.contend(regPairs[1], tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
ioBus.write(regPairs[1], 0, tstates);
if (isContendedMemory || isULAPort) {
	ioBus.contend(regPairs[1]);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(regPairs[1]); tstates += 1;
		ioBus.contend(regPairs[1]); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
	break;case 114:
	
	var sub16temp = regPairs[3] - regPairs[11] - (regs[0] & 1);
var lookup = ( (regPairs[3] & 0x8800) >> 11 ) | ( (regPairs[11] & 0x8800) >> 10 ) | ( (sub16temp & 0x8800) >>  9 );
regPairs[3] = sub16temp;
regs[0] = ( sub16temp & 0x10000 ? 1 : 0 ) | 2 | overflowSubTable[lookup >> 4] | (regs[7] & 168) | halfcarrySubTable[lookup&0x07] | (regPairs[3] ? 0 : 64);
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 115:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regPairs[11] & 0xff);;
addr = (addr + 1) & 0xffff;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regPairs[11] >> 8);;
	break;case 116:
	
	var val = regs[1];
var subtemp = -val;
var lookup = ( (val & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 117:
	
	iff1 = iff2;
var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++; 
regPairs[12] = (h<<8) | l;
	break;case 118:
	
	im = 1;
	break;case 120:
	
	var port = regPairs[1];
var isContendedMemory = memory.isContended(port);
var isULAPort = ioBus.isULAPort(port);
if (isContendedMemory) tstates += ioBus.contend(port, tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
regs[1] = ioBus.read(port);
if (isContendedMemory || isULAPort) {
	ioBus.contend(port);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(port); tstates += 1;
		ioBus.contend(port); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
regs[0] = (regs[0] & 1) | sz53pTable[regs[1]];
	break;case 121:
	
	var isContendedMemory = memory.isContended(regPairs[1]);
var isULAPort = ioBus.isULAPort(regPairs[1]);
if (isContendedMemory) tstates += ioBus.contend(regPairs[1], tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
ioBus.write(regPairs[1], regs[1], tstates);
if (isContendedMemory || isULAPort) {
	ioBus.contend(regPairs[1]);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(regPairs[1]); tstates += 1;
		ioBus.contend(regPairs[1]); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
	break;case 122:
	
	var add16temp = regPairs[3] + regPairs[11] + (regs[0] & 1);
var lookup = (
	( (regPairs[3] & 0x8800) >> 11 ) |
	( (regPairs[11] & 0x8800) >> 10 ) |
	( (add16temp & 0x8800) >>  9 )
);
regPairs[3] = add16temp;
regs[0] = (
	(add16temp & 0x10000 ? 1 : 0) |
	overflowAddTable[lookup >> 4] |
	(regs[7] & 168) |
	halfcarryAddTable[lookup & 0x07] |
	(regPairs[3] ? 0 : 64)
);
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 123:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
l = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
addr = (addr + 1) & 0xffff;
h = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regPairs[11] = (h<<8) | l;
	break;case 124:
	
	var val = regs[1];
var subtemp = -val;
var lookup = ( (val & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 125:
	
	iff1 = iff2;
var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++; 
regPairs[12] = (h<<8) | l;
	break;case 126:
	
	im = 2;
	break;case 160:
	
	var bytetemp = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
regPairs[1]--;
(tstates += memory.contend(regPairs[2], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[2],bytetemp);;
var originalDE = regPairs[2];
regPairs[2]++; regPairs[3]++;
bytetemp = (bytetemp + regs[1]) & 0xff;
regs[0] = (regs[0] & 193) | (regPairs[1] ? 4 : 0) | (bytetemp & 8) | ((bytetemp & 0x02) ? 32 : 0);
(tstates += memory.contend(originalDE, tstates) + ( 1));
(tstates += memory.contend(originalDE, tstates) + ( 1));
	break;case 161:
	
	var value = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
var bytetemp = (regs[1] - value) & 0xff;
var lookup = ((regs[1] & 0x08) >> 3) | ((value & 0x08) >> 2) | ((bytetemp & 0x08) >> 1);
var originalHL = regPairs[3];
(tstates += memory.contend(originalHL, tstates) + ( 1));
(tstates += memory.contend(originalHL, tstates) + ( 1));
(tstates += memory.contend(originalHL, tstates) + ( 1));
(tstates += memory.contend(originalHL, tstates) + ( 1));
(tstates += memory.contend(originalHL, tstates) + ( 1));
regPairs[3]++; regPairs[1]--;
regs[0] = (regs[0] & 1) | (regPairs[1] ? 6 : 2) | halfcarrySubTable[lookup] | (bytetemp ? 0 : 64) | (bytetemp & 128);
if (regs[0] & 16) bytetemp--;
regs[0] |= (bytetemp & 8) | ( (bytetemp & 0x02) ? 32 : 0 );
	break;case 162:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
var isContendedMemory = memory.isContended(regPairs[1]);
var isULAPort = ioBus.isULAPort(regPairs[1]);
if (isContendedMemory) tstates += ioBus.contend(regPairs[1], tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
var initemp = ioBus.read(regPairs[1]);
if (isContendedMemory || isULAPort) {
	ioBus.contend(regPairs[1]);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(regPairs[1]); tstates += 1;
		ioBus.contend(regPairs[1]); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], initemp);;
regs[3]--;
var originalHL = regPairs[3];
regPairs[3]++;
var initemp2 = (initemp + regs[2] + 1) & 0xff;

regs[0] = (initemp & 0x80 ? 2 : 0) | ((initemp2 < initemp) ? 17 : 0 ) | ( parityTable[ (initemp2 & 0x07) ^ regs[3] ] ? 4 : 0 ) | sz53Table[regs[3]];
	break;case 163:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
var outitemp = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
regs[3]--;	/* This does happen first, despite what the specs say */
var isContendedMemory = memory.isContended(regPairs[1]);
var isULAPort = ioBus.isULAPort(regPairs[1]);
if (isContendedMemory) tstates += ioBus.contend(regPairs[1], tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
ioBus.write(regPairs[1], outitemp, tstates);
if (isContendedMemory || isULAPort) {
	ioBus.contend(regPairs[1]);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(regPairs[1]); tstates += 1;
		ioBus.contend(regPairs[1]); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};

regPairs[3]++;
outitemp2 = (outitemp + regs[6]) & 0xff;
regs[0] = (outitemp & 0x80 ? 2 : 0) | ( (outitemp2 < outitemp) ? 17 : 0) | (parityTable[ (outitemp2 & 0x07) ^ regs[3] ] ? 4 : 0 ) | sz53Table[ regs[3] ];
	break;case 168:
	
	var bytetemp = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
regPairs[1]--;
(tstates += memory.contend(regPairs[2], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[2],bytetemp);;
var originalDE = regPairs[2];
regPairs[2]--; regPairs[3]--;
bytetemp = (bytetemp + regs[1]) & 0xff;
regs[0] = (regs[0] & 193) | (regPairs[1] ? 4 : 0) | (bytetemp & 8) | ((bytetemp & 0x02) ? 32 : 0);
(tstates += memory.contend(originalDE, tstates) + ( 1));
(tstates += memory.contend(originalDE, tstates) + ( 1));
	break;case 169:
	
	var value = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
var bytetemp = (regs[1] - value) & 0xff;
var lookup = ((regs[1] & 0x08) >> 3) | ((value & 0x08) >> 2) | ((bytetemp & 0x08) >> 1);
var originalHL = regPairs[3];
(tstates += memory.contend(originalHL, tstates) + ( 1));
(tstates += memory.contend(originalHL, tstates) + ( 1));
(tstates += memory.contend(originalHL, tstates) + ( 1));
(tstates += memory.contend(originalHL, tstates) + ( 1));
(tstates += memory.contend(originalHL, tstates) + ( 1));
regPairs[3]--; regPairs[1]--;
regs[0] = (regs[0] & 1) | (regPairs[1] ? 6 : 2) | halfcarrySubTable[lookup] | (bytetemp ? 0 : 64) | (bytetemp & 128);
if (regs[0] & 16) bytetemp--;
regs[0] |= (bytetemp & 8) | ( (bytetemp & 0x02) ? 32 : 0 );
	break;case 170:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
var isContendedMemory = memory.isContended(regPairs[1]);
var isULAPort = ioBus.isULAPort(regPairs[1]);
if (isContendedMemory) tstates += ioBus.contend(regPairs[1], tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
var initemp = ioBus.read(regPairs[1]);
if (isContendedMemory || isULAPort) {
	ioBus.contend(regPairs[1]);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(regPairs[1]); tstates += 1;
		ioBus.contend(regPairs[1]); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], initemp);;
regs[3]--;
var originalHL = regPairs[3];
regPairs[3]--;
var initemp2 = (initemp + regs[2] - 1) & 0xff;

regs[0] = (initemp & 0x80 ? 2 : 0) | ((initemp2 < initemp) ? 17 : 0 ) | ( parityTable[ (initemp2 & 0x07) ^ regs[3] ] ? 4 : 0 ) | sz53Table[regs[3]];
	break;case 171:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
var outitemp = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
regs[3]--;	/* This does happen first, despite what the specs say */
var isContendedMemory = memory.isContended(regPairs[1]);
var isULAPort = ioBus.isULAPort(regPairs[1]);
if (isContendedMemory) tstates += ioBus.contend(regPairs[1], tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
ioBus.write(regPairs[1], outitemp, tstates);
if (isContendedMemory || isULAPort) {
	ioBus.contend(regPairs[1]);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(regPairs[1]); tstates += 1;
		ioBus.contend(regPairs[1]); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};

regPairs[3]--;
outitemp2 = (outitemp + regs[6]) & 0xff;
regs[0] = (outitemp & 0x80 ? 2 : 0) | ( (outitemp2 < outitemp) ? 17 : 0) | (parityTable[ (outitemp2 & 0x07) ^ regs[3] ] ? 4 : 0 ) | sz53Table[ regs[3] ];
	break;case 176:
	
	var bytetemp = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
regPairs[1]--;
(tstates += memory.contend(regPairs[2], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[2],bytetemp);;
var originalDE = regPairs[2];
regPairs[2]++; regPairs[3]++;
bytetemp = (bytetemp + regs[1]) & 0xff;
regs[0] = (regs[0] & 193) | (regPairs[1] ? 4 : 0) | (bytetemp & 8) | ((bytetemp & 0x02) ? 32 : 0);
(tstates += memory.contend(originalDE, tstates) + ( 1));
(tstates += memory.contend(originalDE, tstates) + ( 1));
if (regPairs[1]) {
	regPairs[12]-=2;
	(tstates += memory.contend(originalDE, tstates) + ( 1));
	(tstates += memory.contend(originalDE, tstates) + ( 1));
	(tstates += memory.contend(originalDE, tstates) + ( 1));
	(tstates += memory.contend(originalDE, tstates) + ( 1));
	(tstates += memory.contend(originalDE, tstates) + ( 1));
}
	break;case 177:
	
	var value = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
var bytetemp = (regs[1] - value) & 0xff;
var lookup = ((regs[1] & 0x08) >> 3) | ((value & 0x08) >> 2) | ((bytetemp & 0x08) >> 1);
var originalHL = regPairs[3];
(tstates += memory.contend(originalHL, tstates) + ( 1));
(tstates += memory.contend(originalHL, tstates) + ( 1));
(tstates += memory.contend(originalHL, tstates) + ( 1));
(tstates += memory.contend(originalHL, tstates) + ( 1));
(tstates += memory.contend(originalHL, tstates) + ( 1));
regPairs[3]++; regPairs[1]--;
regs[0] = (regs[0] & 1) | (regPairs[1] ? 6 : 2) | halfcarrySubTable[lookup] | (bytetemp ? 0 : 64) | (bytetemp & 128);
if (regs[0] & 16) bytetemp--;
regs[0] |= (bytetemp & 8) | ( (bytetemp & 0x02) ? 32 : 0 );
if ((regs[0] & 68) == 4) {
	regPairs[12] -= 2;
	(tstates += memory.contend(originalHL, tstates) + ( 1));
	(tstates += memory.contend(originalHL, tstates) + ( 1));
	(tstates += memory.contend(originalHL, tstates) + ( 1));
	(tstates += memory.contend(originalHL, tstates) + ( 1));
	(tstates += memory.contend(originalHL, tstates) + ( 1));
}
	break;case 178:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
var isContendedMemory = memory.isContended(regPairs[1]);
var isULAPort = ioBus.isULAPort(regPairs[1]);
if (isContendedMemory) tstates += ioBus.contend(regPairs[1], tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
var initemp = ioBus.read(regPairs[1]);
if (isContendedMemory || isULAPort) {
	ioBus.contend(regPairs[1]);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(regPairs[1]); tstates += 1;
		ioBus.contend(regPairs[1]); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], initemp);;
regs[3]--;
var originalHL = regPairs[3];
regPairs[3]++;
var initemp2 = (initemp + regs[2] + 1) & 0xff;

regs[0] = (initemp & 0x80 ? 2 : 0) | ((initemp2 < initemp) ? 17 : 0 ) | ( parityTable[ (initemp2 & 0x07) ^ regs[3] ] ? 4 : 0 ) | sz53Table[regs[3]];
if (regs[3]) {
	(tstates += memory.contend(originalHL, tstates) + ( 1));
	(tstates += memory.contend(originalHL, tstates) + ( 1));
	(tstates += memory.contend(originalHL, tstates) + ( 1));
	(tstates += memory.contend(originalHL, tstates) + ( 1));
	(tstates += memory.contend(originalHL, tstates) + ( 1));
	regPairs[12] -= 2;
}
	break;case 179:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
var outitemp = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
regs[3]--;	/* This does happen first, despite what the specs say */
var isContendedMemory = memory.isContended(regPairs[1]);
var isULAPort = ioBus.isULAPort(regPairs[1]);
if (isContendedMemory) tstates += ioBus.contend(regPairs[1], tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
ioBus.write(regPairs[1], outitemp, tstates);
if (isContendedMemory || isULAPort) {
	ioBus.contend(regPairs[1]);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(regPairs[1]); tstates += 1;
		ioBus.contend(regPairs[1]); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};

regPairs[3]++;
outitemp2 = (outitemp + regs[6]) & 0xff;
regs[0] = (outitemp & 0x80 ? 2 : 0) | ( (outitemp2 < outitemp) ? 17 : 0) | (parityTable[ (outitemp2 & 0x07) ^ regs[3] ] ? 4 : 0 ) | sz53Table[ regs[3] ];
if (regs[3]) {
	regPairs[12]-=2;
	(tstates += memory.contend(regPairs[1], tstates) + ( 1));
	(tstates += memory.contend(regPairs[1], tstates) + ( 1));
	(tstates += memory.contend(regPairs[1], tstates) + ( 1));
	(tstates += memory.contend(regPairs[1], tstates) + ( 1));
	(tstates += memory.contend(regPairs[1], tstates) + ( 1));
}
	break;case 184:
	
	var bytetemp = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
regPairs[1]--;
(tstates += memory.contend(regPairs[2], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[2],bytetemp);;
var originalDE = regPairs[2];
regPairs[2]--; regPairs[3]--;
bytetemp = (bytetemp + regs[1]) & 0xff;
regs[0] = (regs[0] & 193) | (regPairs[1] ? 4 : 0) | (bytetemp & 8) | ((bytetemp & 0x02) ? 32 : 0);
(tstates += memory.contend(originalDE, tstates) + ( 1));
(tstates += memory.contend(originalDE, tstates) + ( 1));
if (regPairs[1]) {
	regPairs[12]-=2;
	(tstates += memory.contend(originalDE, tstates) + ( 1));
	(tstates += memory.contend(originalDE, tstates) + ( 1));
	(tstates += memory.contend(originalDE, tstates) + ( 1));
	(tstates += memory.contend(originalDE, tstates) + ( 1));
	(tstates += memory.contend(originalDE, tstates) + ( 1));
}
	break;case 185:
	
	var value = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
var bytetemp = (regs[1] - value) & 0xff;
var lookup = ((regs[1] & 0x08) >> 3) | ((value & 0x08) >> 2) | ((bytetemp & 0x08) >> 1);
var originalHL = regPairs[3];
(tstates += memory.contend(originalHL, tstates) + ( 1));
(tstates += memory.contend(originalHL, tstates) + ( 1));
(tstates += memory.contend(originalHL, tstates) + ( 1));
(tstates += memory.contend(originalHL, tstates) + ( 1));
(tstates += memory.contend(originalHL, tstates) + ( 1));
regPairs[3]--; regPairs[1]--;
regs[0] = (regs[0] & 1) | (regPairs[1] ? 6 : 2) | halfcarrySubTable[lookup] | (bytetemp ? 0 : 64) | (bytetemp & 128);
if (regs[0] & 16) bytetemp--;
regs[0] |= (bytetemp & 8) | ( (bytetemp & 0x02) ? 32 : 0 );
if ((regs[0] & 68) == 4) {
	regPairs[12] -= 2;
	(tstates += memory.contend(originalHL, tstates) + ( 1));
	(tstates += memory.contend(originalHL, tstates) + ( 1));
	(tstates += memory.contend(originalHL, tstates) + ( 1));
	(tstates += memory.contend(originalHL, tstates) + ( 1));
	(tstates += memory.contend(originalHL, tstates) + ( 1));
}
	break;case 186:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
var isContendedMemory = memory.isContended(regPairs[1]);
var isULAPort = ioBus.isULAPort(regPairs[1]);
if (isContendedMemory) tstates += ioBus.contend(regPairs[1], tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
var initemp = ioBus.read(regPairs[1]);
if (isContendedMemory || isULAPort) {
	ioBus.contend(regPairs[1]);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(regPairs[1]); tstates += 1;
		ioBus.contend(regPairs[1]); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
(tstates += memory.contend(regPairs[3], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[3], initemp);;
regs[3]--;
var originalHL = regPairs[3];
regPairs[3]--;
var initemp2 = (initemp + regs[2] - 1) & 0xff;

regs[0] = (initemp & 0x80 ? 2 : 0) | ((initemp2 < initemp) ? 17 : 0 ) | ( parityTable[ (initemp2 & 0x07) ^ regs[3] ] ? 4 : 0 ) | sz53Table[regs[3]];
if (regs[3]) {
	(tstates += memory.contend(originalHL, tstates) + ( 1));
	(tstates += memory.contend(originalHL, tstates) + ( 1));
	(tstates += memory.contend(originalHL, tstates) + ( 1));
	(tstates += memory.contend(originalHL, tstates) + ( 1));
	(tstates += memory.contend(originalHL, tstates) + ( 1));
	regPairs[12] -= 2;
}
	break;case 187:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
var outitemp = ((tstates += memory.contend(regPairs[3], tstates) + ( 3)), memory.read(regPairs[3]));
regs[3]--;	/* This does happen first, despite what the specs say */
var isContendedMemory = memory.isContended(regPairs[1]);
var isULAPort = ioBus.isULAPort(regPairs[1]);
if (isContendedMemory) tstates += ioBus.contend(regPairs[1], tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
ioBus.write(regPairs[1], outitemp, tstates);
if (isContendedMemory || isULAPort) {
	ioBus.contend(regPairs[1]);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(regPairs[1]); tstates += 1;
		ioBus.contend(regPairs[1]); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};

regPairs[3]--;
outitemp2 = (outitemp + regs[6]) & 0xff;
regs[0] = (outitemp & 0x80 ? 2 : 0) | ( (outitemp2 < outitemp) ? 17 : 0) | (parityTable[ (outitemp2 & 0x07) ^ regs[3] ] ? 4 : 0 ) | sz53Table[ regs[3] ];
if (regs[3]) {
	regPairs[12]-=2;
	(tstates += memory.contend(regPairs[1], tstates) + ( 1));
	(tstates += memory.contend(regPairs[1], tstates) + ( 1));
	(tstates += memory.contend(regPairs[1], tstates) + ( 1));
	(tstates += memory.contend(regPairs[1], tstates) + ( 1));
	(tstates += memory.contend(regPairs[1], tstates) + ( 1));
}
	break;
	default:
		var addr = regPairs[12] - 1;
		throw("Unimplemented opcode " + opcode + " in page ed - PC = " + addr);
}
					break;
				case 'FD':
					(tstates += memory.contend(regPairs[12], tstates) + ( 4));
					opcode = memory.read(regPairs[12]); regPairs[12]++;
					regs[20] = ((regs[20] + 1) & 0x7f) | (regs[20] & 0x80);
					switch (opcode) {
	case 0:
	
			
	break;case 1:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
regPairs[1] = (h<<8) | l;
	break;case 2:
	
	(tstates += memory.contend(regPairs[1], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[1], regs[1]);;
	break;case 3:
	
	regPairs[1]++;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 4:
	
	

regs[0] = (regs[0] & 1) | (regs[3] & 0x0f ? 0 : 16) | 2;
regs[3] = (regs[3] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[3] == 0x80 ? 4 : 0 ) | ( regs[3] & 0x0f ? 0 : 16 ) | sz53Table[regs[3]];
	break;case 5:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[3] & 0x0f ? 0 : 16 ) | 2;
regs[3] = (regs[3] - 1) ;


regs[0] |= (regs[3] == 0x7f ? 4 : 0) | sz53Table[regs[3]];
	break;case 6:
	
	regs[3] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 7:
	
	regs[1] = (regs[1] << 1) | (regs[1] >> 7);
regs[0] = (regs[0] & 196) | (regs[1] & 41);
	break;case 8:
	
	var temp = regPairs[0];
regPairs[0] = regPairs[4];
regPairs[4] = temp;
	break;case 9:
	
	var add16temp = regPairs[9] + regPairs[1];
var lookup = ( (regPairs[9] & 0x0800) >> 11 ) | ( (regPairs[1] & 0x0800) >> 10 ) | ( (add16temp & 0x0800) >>  9 );
regPairs[9] = add16temp;
regs[0] = ( regs[0] & ( 196 ) ) | ( add16temp & 0x10000 ? 1 : 0 ) | ( ( add16temp >> 8 ) & ( 40 ) ) | halfcarryAddTable[lookup];
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 10:
	
	regs[1] = ((tstates += memory.contend(regPairs[1], tstates) + ( 3)), memory.read(regPairs[1]));
	break;case 11:
	
	regPairs[1]--;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 12:
	
	

regs[0] = (regs[0] & 1) | (regs[2] & 0x0f ? 0 : 16) | 2;
regs[2] = (regs[2] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[2] == 0x80 ? 4 : 0 ) | ( regs[2] & 0x0f ? 0 : 16 ) | sz53Table[regs[2]];
	break;case 13:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[2] & 0x0f ? 0 : 16 ) | 2;
regs[2] = (regs[2] - 1) ;


regs[0] |= (regs[2] == 0x7f ? 4 : 0) | sz53Table[regs[2]];
	break;case 14:
	
	regs[2] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 15:
	
	regs[0] = (regs[0] & 196) | (regs[1] & 1);
regs[1] = (regs[1] >> 1) | (regs[1] << 7);
regs[0] |= (regs[1] & 40);
	break;case 16:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regs[3]--;
if (regs[3]) {
	/* take branch */
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[12] += (offset & 0x80 ? offset - 0x100 : offset);
} else {
	/* do not take branch */
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 17:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
regPairs[2] = (h<<8) | l;
	break;case 18:
	
	(tstates += memory.contend(regPairs[2], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[2], regs[1]);;
	break;case 19:
	
	regPairs[2]++;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 20:
	
	

regs[0] = (regs[0] & 1) | (regs[5] & 0x0f ? 0 : 16) | 2;
regs[5] = (regs[5] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[5] == 0x80 ? 4 : 0 ) | ( regs[5] & 0x0f ? 0 : 16 ) | sz53Table[regs[5]];
	break;case 21:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[5] & 0x0f ? 0 : 16 ) | 2;
regs[5] = (regs[5] - 1) ;


regs[0] |= (regs[5] == 0x7f ? 4 : 0) | sz53Table[regs[5]];
	break;case 22:
	
	regs[5] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 23:
	
	var bytetemp = regs[1];
regs[1] = (regs[1] << 1) | (regs[0] & 1);
regs[0] = (regs[0] & 196) | (regs[1] & 40) | (bytetemp >> 7);
	break;case 24:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
regPairs[12] += (offset & 0x80 ? offset - 0x100 : offset);
	break;case 25:
	
	var add16temp = regPairs[9] + regPairs[2];
var lookup = ( (regPairs[9] & 0x0800) >> 11 ) | ( (regPairs[2] & 0x0800) >> 10 ) | ( (add16temp & 0x0800) >>  9 );
regPairs[9] = add16temp;
regs[0] = ( regs[0] & ( 196 ) ) | ( add16temp & 0x10000 ? 1 : 0 ) | ( ( add16temp >> 8 ) & ( 40 ) ) | halfcarryAddTable[lookup];
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 26:
	
	regs[1] = ((tstates += memory.contend(regPairs[2], tstates) + ( 3)), memory.read(regPairs[2]));
	break;case 27:
	
	regPairs[2]--;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 28:
	
	

regs[0] = (regs[0] & 1) | (regs[4] & 0x0f ? 0 : 16) | 2;
regs[4] = (regs[4] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[4] == 0x80 ? 4 : 0 ) | ( regs[4] & 0x0f ? 0 : 16 ) | sz53Table[regs[4]];
	break;case 29:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[4] & 0x0f ? 0 : 16 ) | 2;
regs[4] = (regs[4] - 1) ;


regs[0] |= (regs[4] == 0x7f ? 4 : 0) | sz53Table[regs[4]];
	break;case 30:
	
	regs[4] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 31:
	
	var bytetemp = regs[1];
regs[1] = (bytetemp >> 1) | (regs[0] << 7);
regs[0] = (regs[0] & 196) | (regs[1] & 40) | (bytetemp & 1);
	break;case 32:
	
	if (!(regs[0] & 64)) {
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[12] += (offset & 0x80 ? offset - 0x100 : offset);
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++; /* skip past offset byte */
}
	break;case 33:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
regPairs[9] = (h<<8) | l;
	break;case 34:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regPairs[9] & 0xff);;
addr = (addr + 1) & 0xffff;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regPairs[9] >> 8);;
	break;case 35:
	
	regPairs[9]++;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 36:
	
	

regs[0] = (regs[0] & 1) | (regs[19] & 0x0f ? 0 : 16) | 2;
regs[19] = (regs[19] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[19] == 0x80 ? 4 : 0 ) | ( regs[19] & 0x0f ? 0 : 16 ) | sz53Table[regs[19]];
	break;case 37:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[19] & 0x0f ? 0 : 16 ) | 2;
regs[19] = (regs[19] - 1) ;


regs[0] |= (regs[19] == 0x7f ? 4 : 0) | sz53Table[regs[19]];
	break;case 38:
	
	regs[19] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 39:
	
	var add = 0;
var carry = regs[0] & 1;
if( ( regs[0] & 16 ) || ( ( regs[1] & 0x0f ) > 9 ) ) add = 6;
if( carry || ( regs[1] > 0x99 ) ) add |= 0x60;
if( regs[1] > 0x99 ) carry = 1;
if( regs[0] & 2 ) {
	
var subtemp = regs[1] - add;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (add & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
} else {
	

var addtemp = regs[1] + add;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (add & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
}
regs[0] = ( regs[0] & -6 ) | carry | parityTable[regs[1]];
	break;case 40:
	
	if (regs[0] & 64) {
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[12] += (offset & 0x80 ? offset - 0x100 : offset);
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++; /* skip past offset byte */
}
	break;case 41:
	
	var add16temp = regPairs[9] + regPairs[9];
var lookup = ( (regPairs[9] & 0x0800) >> 11 ) | ( (regPairs[9] & 0x0800) >> 10 ) | ( (add16temp & 0x0800) >>  9 );
regPairs[9] = add16temp;
regs[0] = ( regs[0] & ( 196 ) ) | ( add16temp & 0x10000 ? 1 : 0 ) | ( ( add16temp >> 8 ) & ( 40 ) ) | halfcarryAddTable[lookup];
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 42:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
l = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
addr = (addr + 1) & 0xffff;
h = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regPairs[9] = (h<<8) | l;
	break;case 43:
	
	regPairs[9]--;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 44:
	
	

regs[0] = (regs[0] & 1) | (regs[18] & 0x0f ? 0 : 16) | 2;
regs[18] = (regs[18] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[18] == 0x80 ? 4 : 0 ) | ( regs[18] & 0x0f ? 0 : 16 ) | sz53Table[regs[18]];
	break;case 45:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[18] & 0x0f ? 0 : 16 ) | 2;
regs[18] = (regs[18] - 1) ;


regs[0] |= (regs[18] == 0x7f ? 4 : 0) | sz53Table[regs[18]];
	break;case 46:
	
	regs[18] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 47:
	
	regs[1] ^= 0xff;
regs[0] = (regs[0] & 197) | (regs[1] & 40) | 18;
	break;case 48:
	
	if (!(regs[0] & 1)) {
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[12] += (offset & 0x80 ? offset - 0x100 : offset);
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++; /* skip past offset byte */
}
	break;case 49:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
regPairs[11] = (h<<8) | l;
	break;case 50:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 51:
	
	regPairs[11]++;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 52:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = (regs[0] & 1) | (val & 0x0f ? 0 : 16) | 2;
val = (val + 1) & 0xff;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
regs[0] = (regs[0] & 1) | ( val == 0x80 ? 4 : 0 ) | ( val & 0x0f ? 0 : 16 ) | sz53Table[val];
	break;case 53:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = (regs[0] & 1 ) | ( val & 0x0f ? 0 : 16 ) | 2;
val = (val - 1) & 0xff;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
regs[0] |= (val == 0x7f ? 4 : 0) | sz53Table[val];
	break;case 54:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[9] + offset) & 0xffff;

var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 55:
	
	regs[0] = (regs[0] & 196) | (regs[1] & 40) | 1;
	break;case 56:
	
	if (regs[0] & 1) {
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[12] += (offset & 0x80 ? offset - 0x100 : offset);
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++; /* skip past offset byte */
}
	break;case 57:
	
	var add16temp = regPairs[9] + regPairs[11];
var lookup = ( (regPairs[9] & 0x0800) >> 11 ) | ( (regPairs[11] & 0x0800) >> 10 ) | ( (add16temp & 0x0800) >>  9 );
regPairs[9] = add16temp;
regs[0] = ( regs[0] & ( 196 ) ) | ( add16temp & 0x10000 ? 1 : 0 ) | ( ( add16temp >> 8 ) & ( 40 ) ) | halfcarryAddTable[lookup];
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 58:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var addr = (h<<8) | l;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
	break;case 59:
	
	regPairs[11]--;
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 60:
	
	

regs[0] = (regs[0] & 1) | (regs[1] & 0x0f ? 0 : 16) | 2;
regs[1] = (regs[1] + 1) ;


regs[0] = (regs[0] & 1) | ( regs[1] == 0x80 ? 4 : 0 ) | ( regs[1] & 0x0f ? 0 : 16 ) | sz53Table[regs[1]];
	break;case 61:
	
	

regs[0] = (regs[0] & 1 ) | ( regs[1] & 0x0f ? 0 : 16 ) | 2;
regs[1] = (regs[1] - 1) ;


regs[0] |= (regs[1] == 0x7f ? 4 : 0) | sz53Table[regs[1]];
	break;case 62:
	
	regs[1] = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	break;case 63:
	
	regs[0] = ( regs[0] & 196 ) | ( (regs[0] & 1) ? 16 : 1 ) | ( regs[1] & 40 );
	break;case 64:
	
	regs[3] = regs[3];
	break;case 65:
	
	regs[3] = regs[2];
	break;case 66:
	
	regs[3] = regs[5];
	break;case 67:
	
	regs[3] = regs[4];
	break;case 68:
	
	regs[3] = regs[19];
	break;case 69:
	
	regs[3] = regs[18];
	break;case 70:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[9] + offset) & 0xffff;

regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
	break;case 71:
	
	regs[3] = regs[1];
	break;case 72:
	
	regs[2] = regs[3];
	break;case 73:
	
	regs[2] = regs[2];
	break;case 74:
	
	regs[2] = regs[5];
	break;case 75:
	
	regs[2] = regs[4];
	break;case 76:
	
	regs[2] = regs[19];
	break;case 77:
	
	regs[2] = regs[18];
	break;case 78:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[9] + offset) & 0xffff;

regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
	break;case 79:
	
	regs[2] = regs[1];
	break;case 80:
	
	regs[5] = regs[3];
	break;case 81:
	
	regs[5] = regs[2];
	break;case 82:
	
	regs[5] = regs[5];
	break;case 83:
	
	regs[5] = regs[4];
	break;case 84:
	
	regs[5] = regs[19];
	break;case 85:
	
	regs[5] = regs[18];
	break;case 86:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[9] + offset) & 0xffff;

regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
	break;case 87:
	
	regs[5] = regs[1];
	break;case 88:
	
	regs[4] = regs[3];
	break;case 89:
	
	regs[4] = regs[2];
	break;case 90:
	
	regs[4] = regs[5];
	break;case 91:
	
	regs[4] = regs[4];
	break;case 92:
	
	regs[4] = regs[19];
	break;case 93:
	
	regs[4] = regs[18];
	break;case 94:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[9] + offset) & 0xffff;

regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
	break;case 95:
	
	regs[4] = regs[1];
	break;case 96:
	
	regs[19] = regs[3];
	break;case 97:
	
	regs[19] = regs[2];
	break;case 98:
	
	regs[19] = regs[5];
	break;case 99:
	
	regs[19] = regs[4];
	break;case 100:
	
	regs[19] = regs[19];
	break;case 101:
	
	regs[19] = regs[18];
	break;case 102:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[9] + offset) & 0xffff;

regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
	break;case 103:
	
	regs[19] = regs[1];
	break;case 104:
	
	regs[18] = regs[3];
	break;case 105:
	
	regs[18] = regs[2];
	break;case 106:
	
	regs[18] = regs[5];
	break;case 107:
	
	regs[18] = regs[4];
	break;case 108:
	
	regs[18] = regs[19];
	break;case 109:
	
	regs[18] = regs[18];
	break;case 110:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[9] + offset) & 0xffff;

regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
	break;case 111:
	
	regs[18] = regs[1];
	break;case 112:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[9] + offset) & 0xffff;

(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 113:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[9] + offset) & 0xffff;

(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 114:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[9] + offset) & 0xffff;

(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 115:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[9] + offset) & 0xffff;

(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 116:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[9] + offset) & 0xffff;

(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 117:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[9] + offset) & 0xffff;

(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 118:
	
	halted = true;
regPairs[12]--;
	break;case 119:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[9] + offset) & 0xffff;

(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 120:
	
	regs[1] = regs[3];
	break;case 121:
	
	regs[1] = regs[2];
	break;case 122:
	
	regs[1] = regs[5];
	break;case 123:
	
	regs[1] = regs[4];
	break;case 124:
	
	regs[1] = regs[19];
	break;case 125:
	
	regs[1] = regs[18];
	break;case 126:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
if (offset & 0x80) offset -= 0x100;
var addr = (regPairs[9] + offset) & 0xffff;

regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
	break;case 127:
	
	regs[1] = regs[1];
	break;case 128:
	
	

var addtemp = regs[1] + regs[3];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[3] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 129:
	
	

var addtemp = regs[1] + regs[2];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[2] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 130:
	
	

var addtemp = regs[1] + regs[5];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[5] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 131:
	
	

var addtemp = regs[1] + regs[4];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[4] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 132:
	
	

var addtemp = regs[1] + regs[19];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[19] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 133:
	
	

var addtemp = regs[1] + regs[18];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[18] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 134:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var addtemp = regs[1] + val;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 135:
	
	

var addtemp = regs[1] + regs[1];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[1] & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 136:
	
	

var adctemp = regs[1] + regs[3] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[3] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 137:
	
	

var adctemp = regs[1] + regs[2] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[2] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 138:
	
	

var adctemp = regs[1] + regs[5] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[5] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 139:
	
	

var adctemp = regs[1] + regs[4] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[4] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 140:
	
	

var adctemp = regs[1] + regs[19] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[19] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 141:
	
	

var adctemp = regs[1] + regs[18] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[18] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 142:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var adctemp = regs[1] + val + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 143:
	
	

var adctemp = regs[1] + regs[1] + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[1] & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 144:
	
	
var subtemp = regs[1] - regs[3];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[3] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 145:
	
	
var subtemp = regs[1] - regs[2];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[2] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 146:
	
	
var subtemp = regs[1] - regs[5];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[5] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 147:
	
	
var subtemp = regs[1] - regs[4];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[4] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 148:
	
	
var subtemp = regs[1] - regs[19];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[19] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 149:
	
	
var subtemp = regs[1] - regs[18];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[18] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 150:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
var subtemp = regs[1] - val;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 151:
	
	
var subtemp = regs[1] - regs[1];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[1] & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 152:
	
	
var sbctemp = regs[1] - regs[3] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[3] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 153:
	
	
var sbctemp = regs[1] - regs[2] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[2] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 154:
	
	
var sbctemp = regs[1] - regs[5] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[5] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 155:
	
	
var sbctemp = regs[1] - regs[4] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[4] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 156:
	
	
var sbctemp = regs[1] - regs[19] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[19] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 157:
	
	
var sbctemp = regs[1] - regs[18] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[18] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 158:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
var sbctemp = regs[1] - val - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 159:
	
	
var sbctemp = regs[1] - regs[1] - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[1] & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 160:
	
	

regs[1] &= regs[3];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 161:
	
	

regs[1] &= regs[2];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 162:
	
	

regs[1] &= regs[5];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 163:
	
	

regs[1] &= regs[4];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 164:
	
	

regs[1] &= regs[19];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 165:
	
	

regs[1] &= regs[18];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 166:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] &= val;
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 167:
	
	

regs[1] &= regs[1];
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 168:
	
	
regs[1] ^= regs[3];
regs[0] = sz53pTable[regs[1]];
	break;case 169:
	
	
regs[1] ^= regs[2];
regs[0] = sz53pTable[regs[1]];
	break;case 170:
	
	
regs[1] ^= regs[5];
regs[0] = sz53pTable[regs[1]];
	break;case 171:
	
	
regs[1] ^= regs[4];
regs[0] = sz53pTable[regs[1]];
	break;case 172:
	
	
regs[1] ^= regs[19];
regs[0] = sz53pTable[regs[1]];
	break;case 173:
	
	
regs[1] ^= regs[18];
regs[0] = sz53pTable[regs[1]];
	break;case 174:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[1] ^= val;
regs[0] = sz53pTable[regs[1]];
	break;case 175:
	
	
regs[1] ^= regs[1];
regs[0] = sz53pTable[regs[1]];
	break;case 176:
	
	

regs[1] |= regs[3];
regs[0] = sz53pTable[regs[1]];
	break;case 177:
	
	

regs[1] |= regs[2];
regs[0] = sz53pTable[regs[1]];
	break;case 178:
	
	

regs[1] |= regs[5];
regs[0] = sz53pTable[regs[1]];
	break;case 179:
	
	

regs[1] |= regs[4];
regs[0] = sz53pTable[regs[1]];
	break;case 180:
	
	

regs[1] |= regs[19];
regs[0] = sz53pTable[regs[1]];
	break;case 181:
	
	

regs[1] |= regs[18];
regs[0] = sz53pTable[regs[1]];
	break;case 182:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] |= val;
regs[0] = sz53pTable[regs[1]];
	break;case 183:
	
	

regs[1] |= regs[1];
regs[0] = sz53pTable[regs[1]];
	break;case 184:
	
	

var cptemp = regs[1] - regs[3];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[3] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[3] & 40 ) | ( cptemp & 128 );
	break;case 185:
	
	

var cptemp = regs[1] - regs[2];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[2] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[2] & 40 ) | ( cptemp & 128 );
	break;case 186:
	
	

var cptemp = regs[1] - regs[5];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[5] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[5] & 40 ) | ( cptemp & 128 );
	break;case 187:
	
	

var cptemp = regs[1] - regs[4];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[4] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[4] & 40 ) | ( cptemp & 128 );
	break;case 188:
	
	

var cptemp = regs[1] - regs[19];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[19] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[19] & 40 ) | ( cptemp & 128 );
	break;case 189:
	
	

var cptemp = regs[1] - regs[18];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[18] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[18] & 40 ) | ( cptemp & 128 );
	break;case 190:
	
	var offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
if (offset & 0x80) offset -= 0x100;
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var cptemp = regs[1] - val;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( val & 40 ) | ( cptemp & 128 );
	break;case 191:
	
	

var cptemp = regs[1] - regs[1];
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (regs[1] & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( regs[1] & 40 ) | ( cptemp & 128 );
	break;case 192:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (!(regs[0] & 64)) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 193:
	
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
regPairs[1] = (h<<8) | l;
	break;case 194:
	
	if (!(regs[0] & 64)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 195:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
regPairs[12] = (h<<8) | l;
	break;case 196:
	
	if (!(regs[0] & 64)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 197:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[1] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[1] & 0xff);;
	break;case 198:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;

var addtemp = regs[1] + val;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (addtemp & 0x88) >> 1 );
regs[1] = addtemp;
regs[0] = ( addtemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 199:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 0;
	break;case 200:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (regs[0] & 64) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 201:
	
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++; 
regPairs[12] = (h<<8) | l;
	break;case 202:
	
	if (regs[0] & 64) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 203:
	
	opcodePrefix = 'FDCB';
interruptible = false;
	break;case 204:
	
	if (regs[0] & 64) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 205:
	
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
(tstates += memory.contend(regPairs[12], tstates) + ( 1));
regPairs[12]++;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = (h<<8) | l;
	break;case 206:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;

var adctemp = regs[1] + val + (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (adctemp & 0x88) >> 1 );
regs[1] = adctemp;
regs[0] = ( adctemp & 0x100 ? 1 : 0 ) | halfcarryAddTable[lookup & 0x07] | overflowAddTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 207:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 8;
	break;case 208:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (!(regs[0] & 1)) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 209:
	
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
regPairs[2] = (h<<8) | l;
	break;case 210:
	
	if (!(regs[0] & 1)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 211:
	
	var port = (regs[1] << 8) | ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var isContendedMemory = memory.isContended(port);
var isULAPort = ioBus.isULAPort(port);
if (isContendedMemory) tstates += ioBus.contend(port, tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
ioBus.write(port, regs[1], tstates);
if (isContendedMemory || isULAPort) {
	ioBus.contend(port);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(port); tstates += 1;
		ioBus.contend(port); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
	break;case 212:
	
	if (!(regs[0] & 1)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 213:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[2] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[2] & 0xff);;
	break;case 214:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var subtemp = regs[1] - val;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (subtemp & 0x88) >> 1 );
regs[1] = subtemp;
regs[0] = ( subtemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 215:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 16;
	break;case 216:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (regs[0] & 1) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 217:
	
	var wordtemp;
wordtemp = regPairs[1]; regPairs[1] = regPairs[5]; regPairs[5] = wordtemp;
wordtemp = regPairs[2]; regPairs[2] = regPairs[6]; regPairs[6] = wordtemp;
wordtemp = regPairs[3]; regPairs[3] = regPairs[7]; regPairs[7] = wordtemp;
	break;case 218:
	
	if (regs[0] & 1) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 219:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var port = (regs[1] << 8) | val;
var isContendedMemory = memory.isContended(port);
var isULAPort = ioBus.isULAPort(port);
if (isContendedMemory) tstates += ioBus.contend(port, tstates);
tstates += 1;
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();;
regs[1] = ioBus.read(port);
if (isContendedMemory || isULAPort) {
	ioBus.contend(port);
	tstates += 1;
	if (!isULAPort) {
		ioBus.contend(port); tstates += 1;
		ioBus.contend(port); tstates += 1;
	} else {
		tstates += 2;
	}
} else {
	tstates += 3;
};
	break;case 220:
	
	if (regs[0] & 1) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 221:
	
	opcodePrefix = 'DD';
interruptible = false;
	break;case 222:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
var sbctemp = regs[1] - val - (regs[0] & 1);
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (sbctemp & 0x88) >> 1 );
regs[1] = sbctemp;
regs[0] = ( sbctemp & 0x100 ? 1 : 0 ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | sz53Table[regs[1]];
	break;case 223:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 24;
	break;case 224:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (!(regs[0] & 4)) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 225:
	
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
regPairs[9] = (h<<8) | l;
	break;case 226:
	
	if (!(regs[0] & 4)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 227:
	
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11]));
var spPlus1 = (regPairs[11] + 1) & 0xffff;
var h = ((tstates += memory.contend(spPlus1, tstates) + ( 3)), memory.read(spPlus1));
(tstates += memory.contend(spPlus1, tstates) + ( 1));
(tstates += memory.contend(spPlus1, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(spPlus1, regPairs[9] >> 8);;
(tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[9] & 0xff);;
regPairs[9] = (h<<8) | l;
(tstates += memory.contend(regPairs[11], tstates) + ( 1));
(tstates += memory.contend(regPairs[11], tstates) + ( 1));
	break;case 228:
	
	if (!(regs[0] & 4)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 229:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[9] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[9] & 0xff);;
	break;case 230:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;

regs[1] &= val;
regs[0] = 16 | sz53pTable[regs[1]];
	break;case 231:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 32;
	break;case 232:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (regs[0] & 4) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 233:
	
	regPairs[12] = regPairs[9];
	break;case 234:
	
	if (regs[0] & 4) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 235:
	
	var temp = regPairs[2];
regPairs[2] = regPairs[3];
regPairs[3] = temp;
	break;case 236:
	
	if (regs[0] & 4) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 237:
	
	opcodePrefix = 'ED';
interruptible = false;
	break;case 238:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
regs[1] ^= val;
regs[0] = sz53pTable[regs[1]];
	break;case 239:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 40;
	break;case 240:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (!(regs[0] & 128)) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 241:
	
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
regPairs[0] = (h<<8) | l;
	break;case 242:
	
	if (!(regs[0] & 128)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 243:
	
	iff1 = iff2 = 0;
	break;case 244:
	
	if (!(regs[0] & 128)) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 245:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[0] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[0] & 0xff);;
	break;case 246:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;

regs[1] |= val;
regs[0] = sz53pTable[regs[1]];
	break;case 247:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 48;
	break;case 248:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
if (regs[0] & 128) {
	var l = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	var h = ((tstates += memory.contend(regPairs[11], tstates) + ( 3)), memory.read(regPairs[11])); regPairs[11]++;
	regPairs[12] = (h<<8) | l;
}
	break;case 249:
	
	regPairs[11] = regPairs[9];
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
(tstates += memory.contend(regPairs[10], tstates) + ( 1));
	break;case 250:
	
	if (regs[0] & 128) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 251:
	
	iff1 = iff2 = 1;
interruptible = false;
	break;case 252:
	
	if (regs[0] & 128) {
	var l = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
	var h = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12]));
	(tstates += memory.contend(regPairs[12], tstates) + ( 1));
	regPairs[12]++;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
	regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
	regPairs[12] = (h<<8) | l;
} else {
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
	(tstates += memory.contend(regPairs[12], tstates) + ( 3));
	regPairs[12]++;
}
	break;case 253:
	
	opcodePrefix = 'FD';
interruptible = false;
	break;case 254:
	
	var val = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;

var cptemp = regs[1] - val;
var lookup = ( (regs[1] & 0x88) >> 3 ) | ( (val & 0x88) >> 2 ) | ( (cptemp & 0x88) >> 1 );
regs[0] = ( cptemp & 0x100 ? 1 : ( cptemp ? 0 : 64 ) ) | 2 | halfcarrySubTable[lookup & 0x07] | overflowSubTable[lookup >> 4] | ( val & 40 ) | ( cptemp & 128 );
	break;case 255:
	
	(tstates += memory.contend(regPairs[10], tstates) + ( 1));
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] >> 8);;
regPairs[11]--; (tstates += memory.contend(regPairs[11], tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(regPairs[11], regPairs[12] & 0xff);;
regPairs[12] = 56;
	break;
	default:
		var addr = regPairs[12] - 1;
		throw("Unimplemented opcode " + opcode + " in page dd - PC = " + addr);
}
					break;
				case 'FDCB':
					offset = ((tstates += memory.contend(regPairs[12], tstates) + ( 3)), memory.read(regPairs[12])); regPairs[12]++;
					if (offset & 0x80) offset -= 0x100;
					(tstates += memory.contend(regPairs[12], tstates) + ( 3));
					opcode = memory.read(regPairs[12]);
					(tstates += memory.contend(regPairs[12], tstates) + ( 1));
					(tstates += memory.contend(regPairs[12], tstates) + ( 1));
					regPairs[12]++;
					switch (opcode) {
	case 0:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] = ( (regs[3] << 1) | (regs[3] >> 7) ) ;
regs[0] = (regs[3] & 1) | sz53pTable[regs[3]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 1:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] = ( (regs[2] << 1) | (regs[2] >> 7) ) ;
regs[0] = (regs[2] & 1) | sz53pTable[regs[2]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 2:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] = ( (regs[5] << 1) | (regs[5] >> 7) ) ;
regs[0] = (regs[5] & 1) | sz53pTable[regs[5]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 3:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] = ( (regs[4] << 1) | (regs[4] >> 7) ) ;
regs[0] = (regs[4] & 1) | sz53pTable[regs[4]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 4:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] = ( (regs[7] << 1) | (regs[7] >> 7) ) ;
regs[0] = (regs[7] & 1) | sz53pTable[regs[7]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 5:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] = ( (regs[6] << 1) | (regs[6] >> 7) ) ;
regs[0] = (regs[6] & 1) | sz53pTable[regs[6]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 6:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val = ( (val << 1) | (val >> 7) ) & 0xff;
regs[0] = (val & 1) | sz53pTable[val];
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 7:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] = ( (regs[1] << 1) | (regs[1] >> 7) ) ;
regs[0] = (regs[1] & 1) | sz53pTable[regs[1]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 8:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[3] & 1;
regs[3] = ( (regs[3] >> 1) | (regs[3] << 7) ) ;
regs[0] |= sz53pTable[regs[3]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 9:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[2] & 1;
regs[2] = ( (regs[2] >> 1) | (regs[2] << 7) ) ;
regs[0] |= sz53pTable[regs[2]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 10:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[5] & 1;
regs[5] = ( (regs[5] >> 1) | (regs[5] << 7) ) ;
regs[0] |= sz53pTable[regs[5]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 11:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[4] & 1;
regs[4] = ( (regs[4] >> 1) | (regs[4] << 7) ) ;
regs[0] |= sz53pTable[regs[4]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 12:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[7] & 1;
regs[7] = ( (regs[7] >> 1) | (regs[7] << 7) ) ;
regs[0] |= sz53pTable[regs[7]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 13:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[6] & 1;
regs[6] = ( (regs[6] >> 1) | (regs[6] << 7) ) ;
regs[0] |= sz53pTable[regs[6]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 14:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = val & 1;
val = ( (val >> 1) | (val << 7) ) & 0xff;
regs[0] |= sz53pTable[val];
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 15:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[1] & 1;
regs[1] = ( (regs[1] >> 1) | (regs[1] << 7) ) ;
regs[0] |= sz53pTable[regs[1]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 16:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rltemp = regs[3];
regs[3] = ( (regs[3] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[3]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 17:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rltemp = regs[2];
regs[2] = ( (regs[2] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[2]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 18:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rltemp = regs[5];
regs[5] = ( (regs[5] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[5]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 19:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rltemp = regs[4];
regs[4] = ( (regs[4] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[4]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 20:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rltemp = regs[7];
regs[7] = ( (regs[7] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[7]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 21:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rltemp = regs[6];
regs[6] = ( (regs[6] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[6]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 22:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
var rltemp = val;
val = ( (val << 1) | (regs[0] & 1) ) & 0xff;
regs[0] = ( rltemp >> 7 ) | sz53pTable[val];
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 23:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rltemp = regs[1];
regs[1] = ( (regs[1] << 1) | (regs[0] & 1) ) ;
regs[0] = ( rltemp >> 7 ) | sz53pTable[regs[1]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 24:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rrtemp = regs[3];
regs[3] = ( (regs[3] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[3]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 25:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rrtemp = regs[2];
regs[2] = ( (regs[2] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[2]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 26:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rrtemp = regs[5];
regs[5] = ( (regs[5] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[5]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 27:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rrtemp = regs[4];
regs[4] = ( (regs[4] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[4]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 28:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rrtemp = regs[7];
regs[7] = ( (regs[7] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[7]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 29:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rrtemp = regs[6];
regs[6] = ( (regs[6] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[6]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 30:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
var rrtemp = val;
val = ( (val >> 1) | ( regs[0] << 7 ) ) & 0xff;
regs[0] = (rrtemp & 1) | sz53pTable[val];
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 31:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

var rrtemp = regs[1];
regs[1] = ( (regs[1] >> 1) | ( regs[0] << 7 ) ) ;
regs[0] = (rrtemp & 1) | sz53pTable[regs[1]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 32:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[3] >> 7;
regs[3] = (regs[3] << 1) ;
regs[0] |= sz53pTable[regs[3]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 33:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[2] >> 7;
regs[2] = (regs[2] << 1) ;
regs[0] |= sz53pTable[regs[2]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 34:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[5] >> 7;
regs[5] = (regs[5] << 1) ;
regs[0] |= sz53pTable[regs[5]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 35:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[4] >> 7;
regs[4] = (regs[4] << 1) ;
regs[0] |= sz53pTable[regs[4]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 36:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[7] >> 7;
regs[7] = (regs[7] << 1) ;
regs[0] |= sz53pTable[regs[7]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 37:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[6] >> 7;
regs[6] = (regs[6] << 1) ;
regs[0] |= sz53pTable[regs[6]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 38:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = val >> 7;
val = (val << 1) & 0xff;
regs[0] |= sz53pTable[val];
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 39:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[1] >> 7;
regs[1] = (regs[1] << 1) ;
regs[0] |= sz53pTable[regs[1]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 40:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[3] & 1;
regs[3] = ( (regs[3] & 0x80) | (regs[3] >> 1) ) ;
regs[0] |= sz53pTable[regs[3]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 41:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[2] & 1;
regs[2] = ( (regs[2] & 0x80) | (regs[2] >> 1) ) ;
regs[0] |= sz53pTable[regs[2]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 42:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[5] & 1;
regs[5] = ( (regs[5] & 0x80) | (regs[5] >> 1) ) ;
regs[0] |= sz53pTable[regs[5]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 43:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[4] & 1;
regs[4] = ( (regs[4] & 0x80) | (regs[4] >> 1) ) ;
regs[0] |= sz53pTable[regs[4]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 44:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[7] & 1;
regs[7] = ( (regs[7] & 0x80) | (regs[7] >> 1) ) ;
regs[0] |= sz53pTable[regs[7]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 45:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[6] & 1;
regs[6] = ( (regs[6] & 0x80) | (regs[6] >> 1) ) ;
regs[0] |= sz53pTable[regs[6]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 46:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = val & 1;
val = ( (val & 0x80) | (val >> 1) ) & 0xff;
regs[0] |= sz53pTable[val];
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 47:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] = regs[1] & 1;
regs[1] = ( (regs[1] & 0x80) | (regs[1] >> 1) ) ;
regs[0] |= sz53pTable[regs[1]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 48:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[3] >> 7;
regs[3] = (((regs[3]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[3]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 49:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[2] >> 7;
regs[2] = (((regs[2]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[2]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 50:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[5] >> 7;
regs[5] = (((regs[5]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[5]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 51:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[4] >> 7;
regs[4] = (((regs[4]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[4]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 52:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[7] >> 7;
regs[7] = (((regs[7]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[7]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 53:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[6] >> 7;
regs[6] = (((regs[6]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[6]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 54:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] =  val >> 7;
val = (((val) << 1) & 0xff) | 0x01;
regs[0] |= sz53pTable[val];
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 55:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[1] >> 7;
regs[1] = (((regs[1]) << 1) ) | 0x01;
regs[0] |= sz53pTable[regs[1]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 56:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[3] & 1;
regs[3] >>= 1;
regs[0] |= sz53pTable[regs[3]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 57:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[2] & 1;
regs[2] >>= 1;
regs[0] |= sz53pTable[regs[2]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 58:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[5] & 1;
regs[5] >>= 1;
regs[0] |= sz53pTable[regs[5]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 59:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[4] & 1;
regs[4] >>= 1;
regs[0] |= sz53pTable[regs[4]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 60:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[7] & 1;
regs[7] >>= 1;
regs[0] |= sz53pTable[regs[7]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 61:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[6] & 1;
regs[6] >>= 1;
regs[0] |= sz53pTable[regs[6]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 62:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] =  val & 1;
val >>= 1;
regs[0] |= sz53pTable[val];
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 63:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[0] =  regs[1] & 1;
regs[1] >>= 1;
regs[0] |= sz53pTable[regs[1]];

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 64:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 1) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 65:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 1) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 66:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 1) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 67:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 1) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 68:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 1) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 69:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 1) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 70:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 1) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 71:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 1) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 72:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 2) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 73:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 2) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 74:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 2) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 75:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 2) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 76:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 2) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 77:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 2) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 78:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 2) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 79:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 2) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 80:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 4) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 81:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 4) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 82:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 4) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 83:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 4) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 84:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 4) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 85:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 4) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 86:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 4) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 87:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 4) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 88:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 8) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 89:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 8) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 90:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 8) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 91:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 8) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 92:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 8) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 93:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 8) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 94:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 8) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 95:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 8) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 96:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 16) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 97:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 16) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 98:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 16) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 99:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 16) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 100:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 16) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 101:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 16) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 102:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 16) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 103:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 16) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 104:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 32) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 105:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 32) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 106:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 32) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 107:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 32) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 108:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 32) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 109:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 32) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 110:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 32) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 111:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 32) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 112:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 64) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 113:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 64) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 114:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 64) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 115:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 64) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 116:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 64) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 117:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 64) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 118:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 64) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 119:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 64) ) regs[0] |= 68;

(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 120:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 128) ) regs[0] |= 68;
if (value & 0x80) regs[0] |= 128;
(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 121:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 128) ) regs[0] |= 68;
if (value & 0x80) regs[0] |= 128;
(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 122:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 128) ) regs[0] |= 68;
if (value & 0x80) regs[0] |= 128;
(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 123:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 128) ) regs[0] |= 68;
if (value & 0x80) regs[0] |= 128;
(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 124:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 128) ) regs[0] |= 68;
if (value & 0x80) regs[0] |= 128;
(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 125:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 128) ) regs[0] |= 68;
if (value & 0x80) regs[0] |= 128;
(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 126:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 128) ) regs[0] |= 68;
if (value & 0x80) regs[0] |= 128;
(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 127:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var value = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
regs[0] = ( regs[0] & 1 ) | 16 | ( ( addr >> 8 ) & 40 );
if ( !(value & 128) ) regs[0] |= 68;
if (value & 0x80) regs[0] |= 128;
(tstates += memory.contend(addr, tstates) + ( 1));
	break;case 128:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] &= 254;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 129:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] &= 254;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 130:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] &= 254;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 131:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] &= 254;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 132:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] &= 254;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 133:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] &= 254;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 134:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val &= 254;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 135:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] &= 254;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 136:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] &= 253;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 137:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] &= 253;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 138:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] &= 253;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 139:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] &= 253;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 140:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] &= 253;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 141:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] &= 253;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 142:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val &= 253;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 143:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] &= 253;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 144:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] &= 251;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 145:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] &= 251;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 146:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] &= 251;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 147:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] &= 251;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 148:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] &= 251;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 149:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] &= 251;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 150:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val &= 251;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 151:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] &= 251;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 152:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] &= 247;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 153:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] &= 247;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 154:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] &= 247;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 155:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] &= 247;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 156:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] &= 247;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 157:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] &= 247;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 158:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val &= 247;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 159:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] &= 247;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 160:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] &= 239;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 161:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] &= 239;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 162:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] &= 239;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 163:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] &= 239;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 164:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] &= 239;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 165:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] &= 239;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 166:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val &= 239;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 167:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] &= 239;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 168:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] &= 223;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 169:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] &= 223;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 170:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] &= 223;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 171:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] &= 223;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 172:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] &= 223;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 173:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] &= 223;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 174:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val &= 223;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 175:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] &= 223;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 176:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] &= 191;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 177:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] &= 191;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 178:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] &= 191;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 179:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] &= 191;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 180:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] &= 191;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 181:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] &= 191;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 182:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val &= 191;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 183:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] &= 191;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 184:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] &= 127;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 185:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] &= 127;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 186:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] &= 127;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 187:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] &= 127;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 188:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] &= 127;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 189:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] &= 127;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 190:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val &= 127;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 191:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] &= 127;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 192:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] |= 1;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 193:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] |= 1;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 194:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] |= 1;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 195:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] |= 1;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 196:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] |= 1;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 197:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] |= 1;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 198:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val |= 1;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 199:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] |= 1;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 200:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] |= 2;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 201:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] |= 2;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 202:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] |= 2;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 203:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] |= 2;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 204:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] |= 2;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 205:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] |= 2;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 206:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val |= 2;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 207:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] |= 2;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 208:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] |= 4;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 209:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] |= 4;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 210:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] |= 4;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 211:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] |= 4;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 212:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] |= 4;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 213:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] |= 4;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 214:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val |= 4;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 215:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] |= 4;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 216:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] |= 8;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 217:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] |= 8;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 218:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] |= 8;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 219:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] |= 8;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 220:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] |= 8;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 221:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] |= 8;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 222:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val |= 8;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 223:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] |= 8;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 224:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] |= 16;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 225:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] |= 16;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 226:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] |= 16;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 227:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] |= 16;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 228:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] |= 16;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 229:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] |= 16;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 230:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val |= 16;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 231:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] |= 16;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 232:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] |= 32;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 233:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] |= 32;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 234:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] |= 32;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 235:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] |= 32;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 236:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] |= 32;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 237:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] |= 32;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 238:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val |= 32;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 239:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] |= 32;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 240:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] |= 64;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 241:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] |= 64;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 242:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] |= 64;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 243:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] |= 64;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 244:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] |= 64;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 245:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] |= 64;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 246:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val |= 64;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 247:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] |= 64;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;case 248:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[3] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[3] |= 128;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[3]);;
	break;case 249:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[2] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[2] |= 128;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[2]);;
	break;case 250:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[5] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[5] |= 128;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[5]);;
	break;case 251:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[4] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[4] |= 128;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[4]);;
	break;case 252:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[7] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[7] |= 128;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[7]);;
	break;case 253:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[6] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[6] |= 128;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[6]);;
	break;case 254:
	
	var addr = (regPairs[9] + offset) & 0xffff;
var val = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));
val |= 128;
(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, val);;
	break;case 255:
	
	var addr = (regPairs[9] + offset) & 0xffff;
regs[1] = ((tstates += memory.contend(addr, tstates) + ( 3)), memory.read(addr));

regs[1] |= 128;

(tstates += memory.contend(addr, tstates) + ( 1));
(tstates += memory.contend(addr, tstates) + ( 3));
while (display.nextEventTime != null && display.nextEventTime < tstates) display.doEvent();
memory.write(addr, regs[1]);;
	break;
	default:
		var addr = regPairs[12] - 1;
		throw("Unimplemented opcode " + opcode + " in page ddcb - PC = " + addr);
}
					break;
				default:
					throw("Unknown opcode prefix: " + lastOpcodePrefix);
			}
		}
		while (display.nextEventTime != null && display.nextEventTime <= tstates) display.doEvent();
	};

	self.reset = function() {
		regPairs[12] = regPairs[10] = 0;
		iff1 = 0; iff2 = 0; im = 0; halted = false;
	};

	self.loadFromSnapshot = function(snapRegs) {
		regPairs[0] = snapRegs['AF'];
		regPairs[1] = snapRegs['BC'];
		regPairs[2] = snapRegs['DE'];
		regPairs[3] = snapRegs['HL'];
		regPairs[4] = snapRegs['AF_'];
		regPairs[5] = snapRegs['BC_'];
		regPairs[6] = snapRegs['DE_'];
		regPairs[7] = snapRegs['HL_'];
		regPairs[8] = snapRegs['IX'];
		regPairs[9] = snapRegs['IY'];
		regPairs[11] = snapRegs['SP'];
		regPairs[12] = snapRegs['PC'];
		regPairs[10] = snapRegs['IR'];
		iff1 = snapRegs['iff1'];
		iff2 = snapRegs['iff2'];
		im = snapRegs['im'];
	};

	/* Register / flag accessors (used for tape trapping and test harness) */
	self.getAF = function() {
		return regPairs[0];
	}
	self.getBC = function() {
		return regPairs[1];
	}
	self.getDE = function() {
		return regPairs[2];
	}
	self.getHL = function() {
		return regPairs[3];
	}
	self.getAF_ = function() {
		return regPairs[4];
	}
	self.getBC_ = function() {
		return regPairs[5];
	}
	self.getDE_ = function() {
		return regPairs[6];
	}
	self.getHL_ = function() {
		return regPairs[7];
	}
	self.getIX = function() {
		return regPairs[8];
	}
	self.getIY = function() {
		return regPairs[9];
	}
	self.getI = function() {
		return regs[21];
	}
	self.getR = function() {
		return regs[20];
	}
	self.getSP = function() {
		return regPairs[11];
	}
	self.getPC = function() {
		return regPairs[12];
	}
	self.getIFF1 = function() {
		return iff1;
	}
	self.getIFF2 = function() {
		return iff2;
	}
	self.getIM = function() {
		return im;
	}
	self.getHalted = function() {
		return halted;
	}

	self.setAF = function(val) {
		regPairs[0] = val;
	}
	self.setBC = function(val) {
		regPairs[1] = val;
	}
	self.setDE = function(val) {
		regPairs[2] = val;
	}
	self.setHL = function(val) {
		regPairs[3] = val;
	}
	self.setAF_ = function(val) {
		regPairs[4] = val;
	}
	self.setBC_ = function(val) {
		regPairs[5] = val;
	}
	self.setDE_ = function(val) {
		regPairs[6] = val;
	}
	self.setHL_ = function(val) {
		regPairs[7] = val;
	}
	self.setIX = function(val) {
		regPairs[8] = val;
	}
	self.setIY = function(val) {
		regPairs[9] = val;
	}
	self.setI = function(val) {
		regs[21] = val;
	}
	self.setR = function(val) {
		regs[20] = val;
	}
	self.setSP = function(val) {
		regPairs[11] = val;
	}
	self.setPC = function(val) {
		regPairs[12] = val;
	}
	self.setIFF1 = function(val) {
		iff1 = val;
	}
	self.setIFF2 = function(val) {
		iff2 = val;
	}
	self.setIM = function(val) {
		im = val;
	}
	self.setHalted = function(val) {
		halted = val;
	}

	self.getTstates = function() {
		return tstates;
	}
	self.setTstates = function(val) {
		tstates = val;
	}

	self.getCarry_ = function() {
		return regs[8] & 1;
	};
	self.setCarry = function(val) {
		if (val) {
			regs[0] |= 1;
		} else {
			regs[0] &= -2;
		}
	};
	self.getA_ = function() {
		return regs[9];
	};

	return self;
};
JSSpeccy.roms = {"48.rom":new Uint8Array([243,175,17,255,255,195,203,17,42,93,92,34,95,92,24,67,195,242,21,255,255,255,255,255,42,93,92,126,205,125,0,208,205,116,0,24,247,255,255,255,195,91,51,255,255,255,255,255,197,42,97,92,229,195,158,22,245,229,42,120,92,35,34,120,92,124,181,32,3,253,52,64,197,213,205,191,2,209,193,225,241,251,201,225,110,253,117,0,237,123,61,92,195,197,22,255,255,255,255,255,255,255,245,229,42,176,92,124,181,32,1,233,225,241,237,69,42,93,92,35,34,93,92,126,201,254,33,208,254,13,200,254,16,216,254,24,63,216,35,254,22,56,1,35,55,34,93,92,201,191,82,78,196,73,78,75,69,89,164,80,201,70,206,80,79,73,78,212,83,67,82,69,69,78,164,65,84,84,210,65,212,84,65,194,86,65,76,164,67,79,68,197,86,65,204,76,69,206,83,73,206,67,79,211,84,65,206,65,83,206,65,67,211,65,84,206,76,206,69,88,208,73,78,212,83,81,210,83,71,206,65,66,211,80,69,69,203,73,206,85,83,210,83,84,82,164,67,72,82,164,78,79,212,66,73,206,79,210,65,78,196,60,189,62,189,60,190,76,73,78,197,84,72,69,206,84,207,83,84,69,208,68,69,70,32,70,206,67,65,212,70,79,82,77,65,212,77,79,86,197,69,82,65,83,197,79,80,69,78,32,163,67,76,79,83,69,32,163,77,69,82,71,197,86,69,82,73,70,217,66,69,69,208,67,73,82,67,76,197,73,78,203,80,65,80,69,210,70,76,65,83,200,66,82,73,71,72,212,73,78,86,69,82,83,197,79,86,69,210,79,85,212,76,80,82,73,78,212,76,76,73,83,212,83,84,79,208,82,69,65,196,68,65,84,193,82,69,83,84,79,82,197,78,69,215,66,79,82,68,69,210,67,79,78,84,73,78,85,197,68,73,205,82,69,205,70,79,210,71,79,32,84,207,71,79,32,83,85,194,73,78,80,85,212,76,79,65,196,76,73,83,212,76,69,212,80,65,85,83,197,78,69,88,212,80,79,75,197,80,82,73,78,212,80,76,79,212,82,85,206,83,65,86,197,82,65,78,68,79,77,73,90,197,73,198,67,76,211,68,82,65,215,67,76,69,65,210,82,69,84,85,82,206,67,79,80,217,66,72,89,54,53,84,71,86,78,74,85,55,52,82,70,67,77,75,73,56,51,69,68,88,14,76,79,57,50,87,83,90,32,13,80,48,49,81,65,227,196,224,228,180,188,189,187,175,176,177,192,167,166,190,173,178,186,229,165,194,225,179,185,193,184,126,220,218,92,183,123,125,216,191,174,170,171,221,222,223,127,181,214,124,213,93,219,182,217,91,215,12,7,6,4,5,8,10,11,9,15,226,42,63,205,200,204,203,94,172,45,43,61,46,44,59,34,199,60,195,62,197,47,201,96,198,58,208,206,168,202,211,212,209,210,169,207,46,47,17,255,255,1,254,254,237,120,47,230,31,40,14,103,125,20,192,214,8,203,60,48,250,83,95,32,244,45,203,0,56,230,122,60,200,254,40,200,254,25,200,123,90,87,254,24,201,205,142,2,192,33,0,92,203,126,32,7,35,53,43,32,2,54,255,125,33,4,92,189,32,238,205,30,3,208,33,0,92,190,40,46,235,33,4,92,190,40,39,203,126,32,4,235,203,126,200,95,119,35,54,5,35,58,9,92,119,35,253,78,7,253,86,1,229,205,51,3,225,119,50,8,92,253,203,1,238,201,35,54,5,35,53,192,58,10,92,119,35,126,24,234,66,22,0,123,254,39,208,254,24,32,3,203,120,192,33,5,2,25,126,55,201,123,254,58,56,47,13,250,79,3,40,3,198,79,201,33,235,1,4,40,3,33,5,2,22,0,25,126,201,33,41,2,203,64,40,244,203,90,40,10,253,203,48,94,192,4,192,198,32,201,198,165,201,254,48,216,13,250,157,3,32,25,33,84,2,203,104,40,211,254,56,48,7,214,32,4,200,198,8,201,214,54,4,200,198,254,201,33,48,2,254,57,40,186,254,48,40,182,230,7,198,128,4,200,238,15,201,4,200,203,104,33,48,2,32,164,214,16,254,34,40,6,254,32,192,62,95,201,62,64,201,243,125,203,61,203,61,47,230,3,79,6,0,221,33,209,3,221,9,58,72,92,230,56,15,15,15,246,8,0,0,0,4,12,13,32,253,14,63,5,194,214,3,238,16,211,254,68,79,203,103,32,9,122,179,40,9,121,77,27,221,233,77,12,221,233,251,201,239,49,39,192,3,52,236,108,152,31,245,4,161,15,56,33,146,92,126,167,32,94,35,78,35,70,120,23,159,185,32,84,35,190,32,80,120,198,60,242,37,4,226,108,4,6,250,4,214,12,48,251,198,12,197,33,110,4,205,6,52,205,180,51,239,4,56,241,134,119,239,192,2,49,56,205,148,30,254,11,48,34,239,224,4,224,52,128,67,85,159,128,1,5,52,53,113,3,56,205,153,30,197,205,153,30,225,80,89,122,179,200,27,195,181,3,207,10,137,2,208,18,134,137,10,151,96,117,137,18,213,23,31,137,27,144,65,2,137,36,208,83,202,137,46,157,54,177,137,56,255,73,62,137,67,255,106,115,137,79,167,0,84,137,92,0,0,0,137,105,20,246,36,137,118,241,16,5,205,251,36,58,59,92,135,250,138,28,225,208,229,205,241,43,98,107,13,248,9,203,254,201,33,63,5,229,33,128,31,203,127,40,3,33,152,12,8,19,221,43,243,62,2,71,16,254,211,254,238,15,6,164,45,32,245,5,37,242,216,4,6,47,16,254,211,254,62,13,6,55,16,254,211,254,1,14,59,8,111,195,7,5,122,179,40,12,221,110,0,124,173,103,62,1,55,195,37,5,108,24,244,121,203,120,16,254,48,4,6,66,16,254,211,254,6,62,32,239,5,175,60,203,21,194,20,5,27,221,35,6,49,62,127,219,254,31,208,122,60,194,254,4,6,59,16,254,201,245,58,72,92,230,56,15,15,15,211,254,62,127,219,254,31,251,56,2,207,12,241,201,20,8,21,243,62,15,211,254,33,63,5,229,219,254,31,230,32,246,2,79,191,192,205,231,5,48,250,33,21,4,16,254,43,124,181,32,249,205,227,5,48,235,6,156,205,227,5,48,228,62,198,184,48,224,36,32,241,6,201,205,231,5,48,213,120,254,212,48,244,205,231,5,208,121,238,3,79,38,0,6,176,24,31,8,32,7,48,15,221,117,0,24,15,203,17,173,192,121,31,79,19,24,7,221,126,0,173,192,221,35,27,8,6,178,46,1,205,227,5,208,62,203,184,203,21,6,176,210,202,5,124,173,103,122,179,32,202,124,254,1,201,205,231,5,208,62,22,61,32,253,167,4,200,62,127,219,254,31,208,169,230,32,40,243,121,47,79,230,7,246,8,211,254,55,201,241,58,116,92,214,224,50,116,92,205,140,28,205,48,37,40,60,1,17,0,58,116,92,167,40,2,14,34,247,213,221,225,6,11,62,32,18,19,16,252,221,54,1,255,205,241,43,33,246,255,11,9,3,48,15,58,116,92,167,32,2,207,14,120,177,40,10,1,10,0,221,229,225,35,235,237,176,223,254,228,32,73,58,116,92,254,3,202,138,28,231,205,178,40,203,249,48,11,33,0,0,58,116,92,61,40,21,207,1,194,138,28,205,48,37,40,24,35,126,221,119,11,35,126,221,119,12,35,221,113,14,62,1,203,113,40,1,60,221,119,0,235,231,254,41,32,218,231,205,238,27,235,195,90,7,254,170,32,31,58,116,92,254,3,202,138,28,231,205,238,27,221,54,11,0,221,54,12,27,33,0,64,221,117,13,221,116,14,24,77,254,175,32,79,58,116,92,254,3,202,138,28,231,205,72,32,32,12,58,116,92,167,202,138,28,205,230,28,24,15,205,130,28,223,254,44,40,12,58,116,92,167,202,138,28,205,230,28,24,4,231,205,130,28,205,238,27,205,153,30,221,113,11,221,112,12,205,153,30,221,113,13,221,112,14,96,105,221,54,0,3,24,68,254,202,40,9,205,238,27,221,54,14,128,24,23,58,116,92,167,194,138,28,231,205,130,28,205,238,27,205,153,30,221,113,13,221,112,14,221,54,0,0,42,89,92,237,91,83,92,55,237,82,221,117,11,221,116,12,42,75,92,237,82,221,117,15,221,116,16,235,58,116,92,167,202,112,9,229,1,17,0,221,9,221,229,17,17,0,175,55,205,86,5,221,225,48,242,62,254,205,1,22,253,54,82,3,14,128,221,126,0,221,190,239,32,2,14,246,254,4,48,217,17,192,9,197,205,10,12,193,221,229,209,33,240,255,25,6,10,126,60,32,3,121,128,79,19,26,190,35,32,1,12,215,16,246,203,121,32,179,62,13,215,225,221,126,0,254,3,40,12,58,116,92,61,202,8,8,254,2,202,182,8,229,221,110,250,221,102,251,221,94,11,221,86,12,124,181,40,13,237,82,56,38,40,7,221,126,0,254,3,32,29,225,124,181,32,6,221,110,13,221,102,14,229,221,225,58,116,92,254,2,55,32,1,167,62,255,205,86,5,216,207,26,221,94,11,221,86,12,229,124,181,32,6,19,19,19,235,24,12,221,110,250,221,102,251,235,55,237,82,56,9,17,5,0,25,68,77,205,5,31,225,221,126,0,167,40,62,124,181,40,19,43,70,43,78,43,3,3,3,221,34,95,92,205,232,25,221,42,95,92,42,89,92,43,221,78,11,221,70,12,197,3,3,3,221,126,253,245,205,85,22,35,241,119,209,35,115,35,114,35,229,221,225,55,62,255,195,2,8,235,42,89,92,43,221,34,95,92,221,78,11,221,70,12,197,205,229,25,193,229,197,205,85,22,221,42,95,92,35,221,78,15,221,70,16,9,34,75,92,221,102,14,124,230,192,32,10,221,110,13,34,66,92,253,54,10,0,209,221,225,55,62,255,195,2,8,221,78,11,221,70,12,197,3,247,54,128,235,209,229,229,221,225,55,62,255,205,2,8,225,237,91,83,92,126,230,192,32,25,26,19,190,35,32,2,26,190,27,43,48,8,229,235,205,184,25,225,24,236,205,44,9,24,226,126,79,254,128,200,229,42,75,92,126,254,128,40,37,185,40,8,197,205,184,25,193,235,24,240,230,224,254,160,32,18,209,213,229,35,19,26,190,32,6,23,48,247,225,24,3,225,24,224,62,255,209,235,60,55,205,44,9,24,196,32,16,8,34,95,92,235,205,184,25,205,232,25,235,42,95,92,8,8,213,205,184,25,34,95,92,42,83,92,227,197,8,56,7,43,205,85,22,35,24,3,205,85,22,35,193,209,237,83,83,92,237,91,95,92,197,213,235,237,176,225,193,213,205,232,25,209,201,229,62,253,205,1,22,175,17,161,9,205,10,12,253,203,2,238,205,212,21,221,229,17,17,0,175,205,194,4,221,225,6,50,118,16,253,221,94,11,221,86,12,62,255,221,225,195,194,4,128,83,116,97,114,116,32,116,97,112,101,44,32,116,104,101,110,32,112,114,101,115,115,32,97,110,121,32,107,101,121,174,13,80,114,111,103,114,97,109,58,160,13,78,117,109,98,101,114,32,97,114,114,97,121,58,160,13,67,104,97,114,97,99,116,101,114,32,97,114,114,97,121,58,160,13,66,121,116,101,115,58,160,205,3,11,254,32,210,217,10,254,6,56,105,254,24,48,101,33,11,10,95,22,0,25,94,25,229,195,3,11,78,87,16,41,84,83,82,55,80,79,95,94,93,92,91,90,84,83,12,62,34,185,32,17,253,203,1,78,32,9,4,14,2,62,24,184,32,3,5,14,33,195,217,13,58,145,92,245,253,54,87,1,62,32,205,101,11,241,50,145,92,201,253,203,1,78,194,205,14,14,33,205,85,12,5,195,217,13,205,3,11,121,61,61,230,16,24,90,62,63,24,108,17,135,10,50,15,92,24,11,17,109,10,24,3,17,135,10,50,14,92,42,81,92,115,35,114,201,17,244,9,205,128,10,42,14,92,87,125,254,22,218,17,34,32,41,68,74,62,31,145,56,12,198,2,79,253,203,1,78,32,22,62,22,144,218,159,30,60,71,4,253,203,2,70,194,85,12,253,190,49,218,134,12,195,217,13,124,205,3,11,129,61,230,31,200,87,253,203,1,198,62,32,205,59,12,21,32,248,201,205,36,11,253,203,1,78,32,26,253,203,2,70,32,8,237,67,136,92,34,132,92,201,237,67,138,92,237,67,130,92,34,134,92,201,253,113,69,34,128,92,201,253,203,1,78,32,20,237,75,136,92,42,132,92,253,203,2,70,200,237,75,138,92,42,134,92,201,253,78,69,42,128,92,201,254,128,56,61,254,144,48,38,71,205,56,11,205,3,11,17,146,92,24,71,33,146,92,205,62,11,203,24,159,230,15,79,203,24,159,230,240,177,14,4,119,35,13,32,251,201,214,165,48,9,198,21,197,237,75,123,92,24,11,205,16,12,195,3,11,197,237,75,54,92,235,33,59,92,203,134,254,32,32,2,203,198,38,0,111,41,41,41,9,193,235,121,61,62,33,32,14,5,79,253,203,1,78,40,6,213,205,205,14,209,121,185,213,204,85,12,209,197,229,58,145,92,6,255,31,56,1,4,31,31,159,79,62,8,167,253,203,1,78,40,5,253,203,48,206,55,235,8,26,160,174,169,18,8,56,19,20,35,61,32,242,235,37,253,203,1,78,204,219,11,225,193,13,35,201,8,62,32,131,95,8,24,230,124,15,15,15,230,3,246,88,103,237,91,143,92,126,171,162,171,253,203,87,118,40,8,230,199,203,87,32,2,238,56,253,203,87,102,40,8,230,248,203,111,32,2,238,7,119,201,229,38,0,227,24,4,17,149,0,245,205,65,12,56,9,62,32,253,203,1,70,204,59,12,26,230,127,205,59,12,26,19,135,48,245,209,254,72,40,3,254,130,216,122,254,3,216,62,32,213,217,215,217,209,201,245,235,60,203,126,35,40,251,61,32,248,235,241,254,32,216,26,214,65,201,253,203,1,78,192,17,217,13,213,120,253,203,2,70,194,2,13,253,190,49,56,27,192,253,203,2,102,40,22,253,94,45,29,40,90,62,0,205,1,22,237,123,63,92,253,203,2,166,201,207,4,253,53,82,32,69,62,24,144,50,140,92,42,143,92,229,58,145,92,245,62,253,205,1,22,175,17,248,12,205,10,12,253,203,2,238,33,59,92,203,222,203,174,217,205,212,21,217,254,32,40,69,254,226,40,65,246,32,254,110,40,59,62,254,205,1,22,241,50,145,92,225,34,143,92,205,254,13,253,70,49,4,14,33,197,205,155,14,124,15,15,15,230,3,246,88,103,17,224,90,26,78,6,32,235,18,113,19,35,16,250,193,201,128,115,99,114,111,108,108,191,207,12,254,2,56,128,253,134,49,214,25,208,237,68,197,71,42,143,92,229,42,145,92,229,205,77,13,120,245,33,107,92,70,120,60,119,33,137,92,190,56,3,52,6,24,205,0,14,241,61,32,232,225,253,117,87,225,34,143,92,237,75,136,92,253,203,2,134,205,217,13,253,203,2,198,193,201,175,42,141,92,253,203,2,70,40,4,103,253,110,14,34,143,92,33,145,92,32,2,126,15,174,230,85,174,119,201,205,175,13,33,60,92,203,174,203,198,205,77,13,253,70,49,205,68,14,33,192,90,58,141,92,5,24,7,14,32,43,119,13,32,251,16,247,253,54,49,2,62,253,205,1,22,42,81,92,17,244,9,167,115,35,114,35,17,168,16,63,56,246,1,33,23,24,42,33,0,0,34,125,92,253,203,48,134,205,148,13,62,254,205,1,22,205,77,13,6,24,205,68,14,42,81,92,17,244,9,115,35,114,253,54,82,1,1,33,24,33,0,91,253,203,1,78,32,18,120,253,203,2,70,40,5,253,134,49,214,24,197,71,205,155,14,193,62,33,145,95,22,0,25,195,220,10,6,23,205,155,14,14,8,197,229,120,230,7,120,32,12,235,33,224,248,25,235,1,32,0,61,237,176,235,33,224,255,25,235,71,230,7,15,15,15,79,120,6,0,237,176,6,7,9,230,248,32,219,225,36,193,13,32,205,205,136,14,33,224,255,25,235,237,176,6,1,197,205,155,14,14,8,197,229,120,230,7,15,15,15,79,120,6,0,13,84,93,54,0,19,237,176,17,1,7,25,61,230,248,71,32,229,225,36,193,13,32,220,205,136,14,98,107,19,58,141,92,253,203,2,70,40,3,58,72,92,119,11,237,176,193,14,33,201,124,15,15,15,61,246,80,103,235,97,104,41,41,41,41,41,68,77,201,62,24,144,87,15,15,15,230,224,111,122,230,24,246,64,103,201,243,6,176,33,0,64,229,197,205,244,14,193,225,36,124,230,7,32,10,125,198,32,111,63,159,230,248,132,103,16,231,24,13,243,33,0,91,6,8,197,205,244,14,193,16,249,62,4,211,251,251,33,0,91,253,117,70,175,71,119,35,16,252,253,203,48,142,14,33,195,217,13,120,254,3,159,230,2,211,251,87,205,84,31,56,10,62,4,211,251,251,205,223,14,207,12,219,251,135,248,48,235,14,32,94,35,6,8,203,18,203,19,203,26,219,251,31,48,251,122,211,251,16,240,13,32,233,201,42,61,92,229,33,127,16,229,237,115,61,92,205,212,21,245,22,0,253,94,255,33,200,0,205,181,3,241,33,56,15,229,254,24,48,49,254,7,56,45,254,16,56,58,1,2,0,87,254,22,56,12,3,253,203,55,126,202,30,16,205,212,21,95,205,212,21,213,42,91,92,253,203,7,134,205,85,22,193,35,112,35,113,24,10,253,203,7,134,42,91,92,205,82,22,18,19,237,83,91,92,201,95,22,0,33,153,15,25,94,25,229,42,91,92,201,9,102,106,80,181,112,126,207,212,42,73,92,253,203,55,110,194,151,16,205,110,25,205,149,22,122,179,202,151,16,229,35,78,35,70,33,10,0,9,68,77,205,5,31,205,151,16,42,81,92,227,229,62,255,205,1,22,225,43,253,53,15,205,85,24,253,52,15,42,89,92,35,35,35,35,34,91,92,225,205,21,22,201,253,203,55,110,32,8,33,73,92,205,15,25,24,109,253,54,0,16,24,29,205,49,16,24,5,126,254,13,200,35,34,91,92,201,205,49,16,1,1,0,195,232,25,205,212,21,205,212,21,225,225,225,34,61,92,253,203,0,126,192,249,201,55,205,149,17,237,82,25,35,193,216,197,68,77,98,107,35,26,230,240,254,16,32,9,35,26,214,23,206,0,32,1,35,167,237,66,9,235,56,230,201,253,203,55,110,192,42,73,92,205,110,25,235,205,149,22,33,74,92,205,28,25,205,149,23,62,0,195,1,22,253,203,55,126,40,168,195,129,15,253,203,48,102,40,161,253,54,0,255,22,0,253,94,254,33,144,26,205,181,3,195,48,15,229,205,144,17,43,205,229,25,34,91,92,253,54,7,0,225,201,253,203,2,94,196,29,17,167,253,203,1,110,200,58,8,92,253,203,1,174,245,253,203,2,110,196,110,13,241,254,32,48,82,254,16,48,45,254,6,48,10,71,230,1,79,120,31,198,18,24,42,32,9,33,106,92,62,8,174,119,24,14,254,14,216,214,13,33,65,92,190,119,32,2,54,0,253,203,2,222,191,201,71,230,7,79,62,16,203,88,32,1,60,253,113,211,17,13,17,24,6,58,13,92,17,168,16,42,79,92,35,35,115,35,114,55,201,205,77,13,253,203,2,158,253,203,2,174,42,138,92,229,42,61,92,229,33,103,17,229,237,115,61,92,42,130,92,229,55,205,149,17,235,205,125,24,235,205,225,24,42,138,92,227,235,205,77,13,58,139,92,146,56,38,32,6,123,253,150,80,48,30,62,32,213,205,244,9,209,24,233,22,0,253,94,254,33,144,26,205,181,3,253,54,0,255,237,91,138,92,24,2,209,225,225,34,61,92,193,213,205,217,13,225,34,130,92,253,54,38,0,201,42,97,92,43,167,237,91,89,92,253,203,55,110,200,237,91,97,92,216,42,99,92,201,126,254,14,1,6,0,204,232,25,126,35,254,13,32,241,201,243,62,255,237,91,178,92,217,237,75,180,92,237,91,56,92,42,123,92,217,71,62,7,211,254,62,63,237,71,0,0,0,0,0,0,98,107,54,2,43,188,32,250,167,237,82,25,35,48,6,53,40,3,53,40,243,43,217,237,67,180,92,237,83,56,92,34,123,92,217,4,40,25,34,180,92,17,175,62,1,168,0,235,237,184,235,35,34,123,92,43,1,64,0,237,67,56,92,34,178,92,33,0,60,34,54,92,42,178,92,54,62,43,249,43,43,34,61,92,237,86,253,33,58,92,251,33,182,92,34,79,92,17,175,21,1,21,0,235,237,176,235,43,34,87,92,35,34,83,92,34,75,92,54,128,35,34,89,92,54,13,35,54,128,35,34,97,92,34,99,92,34,101,92,62,56,50,141,92,50,143,92,50,72,92,33,35,5,34,9,92,253,53,198,253,53,202,33,198,21,17,16,92,1,14,0,237,176,253,203,1,206,205,223,14,253,54,49,2,205,107,13,175,17,56,21,205,10,12,253,203,2,238,24,7,253,54,49,2,205,149,23,205,176,22,62,0,205,1,22,205,44,15,205,23,27,253,203,0,126,32,18,253,203,48,102,40,64,42,89,92,205,167,17,253,54,0,255,24,221,42,89,92,34,93,92,205,251,25,120,177,194,93,21,223,254,13,40,192,253,203,48,70,196,175,13,205,110,13,62,25,253,150,79,50,140,92,253,203,1,254,253,54,0,255,253,54,10,1,205,138,27,118,253,203,1,174,253,203,48,78,196,205,14,58,58,92,60,245,33,0,0,253,116,55,253,116,38,34,11,92,33,1,0,34,22,92,205,176,22,253,203,55,174,205,110,13,253,203,2,238,241,71,254,10,56,2,198,7,205,239,21,62,32,215,120,17,145,19,205,10,12,175,17,54,21,205,10,12,237,75,69,92,205,27,26,62,58,215,253,78,13,6,0,205,27,26,205,151,16,58,58,92,60,40,27,254,9,40,4,254,21,32,3,253,52,13,1,3,0,17,112,92,33,68,92,203,126,40,1,9,237,184,253,54,10,255,253,203,1,158,195,172,18,128,79,203,78,69,88,84,32,119,105,116,104,111,117,116,32,70,79,210,86,97,114,105,97,98,108,101,32,110,111,116,32,102,111,117,110,228,83,117,98,115,99,114,105,112,116,32,119,114,111,110,231,79,117,116,32,111,102,32,109,101,109,111,114,249,79,117,116,32,111,102,32,115,99,114,101,101,238,78,117,109,98,101,114,32,116,111,111,32,98,105,231,82,69,84,85,82,78,32,119,105,116,104,111,117,116,32,71,79,83,85,194,69,110,100,32,111,102,32,102,105,108,229,83,84,79,80,32,115,116,97,116,101,109,101,110,244,73,110,118,97,108,105,100,32,97,114,103,117,109,101,110,244,73,110,116,101,103,101,114,32,111,117,116,32,111,102,32,114,97,110,103,229,78,111,110,115,101,110,115,101,32,105,110,32,66,65,83,73,195,66,82,69,65,75,32,45,32,67,79,78,84,32,114,101,112,101,97,116,243,79,117,116,32,111,102,32,68,65,84,193,73,110,118,97,108,105,100,32,102,105,108,101,32,110,97,109,229,78,111,32,114,111,111,109,32,102,111,114,32,108,105,110,229,83,84,79,80,32,105,110,32,73,78,80,85,212,70,79,82,32,119,105,116,104,111,117,116,32,78,69,88,212,73,110,118,97,108,105,100,32,73,47,79,32,100,101,118,105,99,229,73,110,118,97,108,105,100,32,99,111,108,111,117,242,66,82,69,65,75,32,105,110,116,111,32,112,114,111,103,114,97,237,82,65,77,84,79,80,32,110,111,32,103,111,111,228,83,116,97,116,101,109,101,110,116,32,108,111,115,244,73,110,118,97,108,105,100,32,115,116,114,101,97,237,70,78,32,119,105,116,104,111,117,116,32,68,69,198,80,97,114,97,109,101,116,101,114,32,101,114,114,111,242,84,97,112,101,32,108,111,97,100,105,110,103,32,101,114,114,111,242,44,160,127,32,49,57,56,50,32,83,105,110,99,108,97,105,114,32,82,101,115,101,97,114,99,104,32,76,116,228,62,16,1,0,0,195,19,19,237,67,73,92,42,93,92,235,33,85,21,229,42,97,92,55,237,82,229,96,105,205,110,25,32,6,205,184,25,205,232,25,193,121,61,176,40,40,197,3,3,3,3,43,237,91,83,92,213,205,85,22,225,34,83,92,193,197,19,42,97,92,43,43,237,184,42,73,92,235,193,112,43,113,43,115,43,114,241,195,162,18,244,9,168,16,75,244,9,196,21,83,129,15,196,21,82,244,9,196,21,80,128,207,18,1,0,6,0,11,0,1,0,1,0,6,0,16,0,253,203,2,110,32,4,253,203,2,222,205,230,21,216,40,250,207,7,217,229,42,81,92,35,35,24,8,30,48,131,217,229,42,81,92,94,35,86,235,205,44,22,225,217,201,135,198,22,111,38,92,94,35,86,122,179,32,2,207,23,27,42,79,92,25,34,81,92,253,203,48,166,35,35,35,35,78,33,45,22,205,220,22,208,22,0,94,25,233,75,6,83,18,80,27,0,253,203,2,198,253,203,1,174,253,203,48,230,24,4,253,203,2,134,253,203,1,142,195,77,13,253,203,1,206,201,1,1,0,229,205,5,31,225,205,100,22,42,101,92,235,237,184,201,245,229,33,75,92,62,14,94,35,86,227,167,237,82,25,227,48,9,213,235,9,235,114,43,115,35,209,35,61,32,232,235,209,241,167,237,82,68,77,3,25,235,201,0,0,235,17,143,22,126,230,192,32,247,86,35,94,201,42,99,92,43,205,85,22,35,35,193,237,67,97,92,193,235,35,201,42,89,92,54,13,34,91,92,35,54,128,35,34,97,92,42,97,92,34,99,92,42,99,92,34,101,92,229,33,146,92,34,104,92,225,201,237,91,89,92,195,229,25,35,126,167,200,185,35,32,248,55,201,205,30,23,205,1,23,1,0,0,17,226,163,235,25,56,7,1,212,21,9,78,35,70,235,113,35,112,201,229,42,79,92,9,35,35,35,78,235,33,22,23,205,220,22,78,6,0,9,233,75,5,83,3,80,1,225,201,205,148,30,254,16,56,2,207,23,198,3,7,33,16,92,79,6,0,9,78,35,70,43,201,239,1,56,205,30,23,120,177,40,22,235,42,79,92,9,35,35,35,126,235,254,75,40,8,254,83,40,4,254,80,32,207,205,93,23,115,35,114,201,229,205,241,43,120,177,32,2,207,14,197,26,230,223,79,33,122,23,205,220,22,48,241,78,6,0,9,193,233,75,6,83,8,80,10,0,30,1,24,6,30,6,24,2,30,16,11,120,177,32,213,87,225,201,24,144,237,115,63,92,253,54,2,16,205,175,13,253,203,2,198,253,70,49,205,68,14,253,203,2,134,253,203,48,198,42,73,92,237,91,108,92,167,237,82,25,56,34,213,205,110,25,17,192,2,235,237,82,227,205,110,25,193,197,205,184,25,193,9,56,14,235,86,35,94,43,237,83,108,92,24,237,34,108,92,42,108,92,205,110,25,40,1,235,205,51,24,253,203,2,166,201,62,3,24,2,62,2,253,54,2,0,205,48,37,196,1,22,223,205,112,32,56,20,223,254,59,40,4,254,44,32,6,231,205,130,28,24,8,205,230,28,24,3,205,222,28,205,238,27,205,153,30,120,230,63,103,105,34,73,92,205,110,25,30,1,205,85,24,215,253,203,2,102,40,246,58,107,92,253,150,79,32,238,171,200,229,213,33,108,92,205,15,25,209,225,24,224,237,75,73,92,205,128,25,22,62,40,5,17,0,0,203,19,253,115,45,126,254,64,193,208,197,205,40,26,35,35,35,253,203,1,134,122,167,40,5,215,253,203,1,198,213,235,253,203,48,150,33,59,92,203,150,253,203,55,110,40,2,203,214,42,95,92,167,237,82,32,5,62,63,205,193,24,205,225,24,235,126,205,182,24,35,254,13,40,6,235,205,55,25,24,224,209,201,254,14,192,35,35,35,35,35,35,126,201,217,42,143,92,229,203,188,203,253,34,143,92,33,145,92,86,213,54,0,205,244,9,225,253,116,87,225,34,143,92,217,201,42,91,92,167,237,82,192,58,65,92,203,7,40,4,198,67,24,22,33,59,92,203,158,62,75,203,86,40,11,203,222,60,253,203,48,94,40,2,62,67,213,205,193,24,209,201,94,35,86,229,235,35,205,110,25,205,149,22,225,253,203,55,110,192,114,43,115,201,123,167,248,24,13,175,9,60,56,252,237,66,61,40,241,195,239,21,205,27,45,48,48,254,33,56,44,253,203,1,150,254,203,40,36,254,58,32,14,253,203,55,110,32,22,253,203,48,86,40,20,24,14,254,34,32,10,245,58,106,92,238,4,50,106,92,241,253,203,1,214,215,201,229,42,83,92,84,93,193,205,128,25,208,197,205,184,25,235,24,244,126,184,192,35,126,43,185,201,35,35,35,34,93,92,14,0,21,200,231,187,32,4,167,201,35,126,205,182,24,34,93,92,254,34,32,1,13,254,58,40,4,254,203,32,4,203,65,40,223,254,13,32,227,21,55,201,229,126,254,64,56,23,203,111,40,20,135,250,199,25,63,1,5,0,48,2,14,18,23,35,126,48,251,24,6,35,35,78,35,70,35,9,209,167,237,82,68,77,25,235,201,205,221,25,197,120,47,71,121,47,79,3,205,100,22,235,225,25,213,237,176,225,201,42,89,92,43,34,93,92,231,33,146,92,34,101,92,205,59,45,205,162,45,56,4,33,240,216,9,218,138,28,195,197,22,213,229,175,203,120,32,32,96,105,30,255,24,8,213,86,35,94,229,235,30,32,1,24,252,205,42,25,1,156,255,205,42,25,14,246,205,42,25,125,205,239,21,225,209,201,177,203,188,191,196,175,180,147,145,146,149,152,152,152,152,152,152,152,127,129,46,108,110,112,72,148,86,63,65,43,23,31,55,119,68,15,89,43,67,45,81,58,109,66,13,73,92,68,21,93,1,61,2,6,0,103,30,6,203,5,240,28,6,0,237,30,0,238,28,0,35,31,4,61,6,204,6,5,3,29,4,0,171,29,5,205,31,5,137,32,5,2,44,5,178,27,0,183,17,3,161,30,5,249,23,8,0,128,30,3,79,30,0,95,30,3,172,30,0,107,13,9,0,220,34,6,0,58,31,5,237,29,5,39,30,3,66,30,9,5,130,35,0,172,14,5,201,31,5,245,23,11,11,11,11,8,0,248,3,9,5,32,35,7,7,7,7,7,7,8,0,122,30,6,0,148,34,5,96,31,6,44,10,0,54,23,6,0,229,22,10,0,147,23,10,44,10,0,147,23,10,0,147,23,0,147,23,253,203,1,190,205,251,25,175,50,71,92,61,50,58,92,24,1,231,205,191,22,253,52,13,250,138,28,223,6,0,254,13,40,122,254,58,40,235,33,118,27,229,79,231,121,214,206,218,138,28,79,33,72,26,9,78,9,24,3,42,116,92,126,35,34,116,92,1,82,27,197,79,254,32,48,12,33,1,28,6,0,9,78,9,229,223,5,201,223,185,194,138,28,231,201,205,84,31,56,2,207,20,253,203,10,126,32,113,42,66,92,203,124,40,20,33,254,255,34,69,92,42,97,92,43,237,91,89,92,27,58,68,92,24,51,205,110,25,58,68,92,40,25,167,32,67,71,126,230,192,120,40,15,207,255,193,205,48,37,200,42,85,92,62,192,166,192,175,254,1,206,0,86,35,94,237,83,69,92,35,94,35,86,235,25,35,34,85,92,235,34,93,92,87,30,0,253,54,10,255,21,253,114,13,202,40,27,20,205,139,25,40,8,207,22,205,48,37,192,193,193,223,254,13,40,186,254,58,202,40,27,195,138,28,15,29,75,9,103,11,123,142,113,180,129,207,205,222,28,191,193,204,238,27,235,42,116,92,78,35,70,235,197,201,205,178,40,253,54,55,0,48,8,253,203,55,206,32,24,207,1,204,150,41,253,203,1,118,32,13,175,205,48,37,196,241,43,33,113,92,182,119,235,237,67,114,92,34,77,92,201,193,205,86,28,205,238,27,201,58,59,92,245,205,251,36,241,253,86,1,170,230,64,32,36,203,122,194,255,42,201,205,178,40,245,121,246,159,60,32,20,241,24,169,231,205,130,28,254,44,32,9,231,205,251,36,253,203,1,118,192,207,11,205,251,36,253,203,1,118,200,24,244,253,203,1,126,253,203,2,134,196,77,13,241,58,116,92,214,19,205,252,33,205,238,27,42,143,92,34,141,92,33,145,92,126,7,174,230,170,174,119,201,205,48,37,40,19,253,203,2,134,205,77,13,33,144,92,126,246,248,119,253,203,87,182,223,205,226,33,24,159,195,5,6,254,13,40,4,254,58,32,156,205,48,37,200,239,160,56,201,207,8,193,205,48,37,40,10,239,2,56,235,205,233,52,218,179,27,195,41,27,254,205,32,9,231,205,130,28,205,238,27,24,6,205,238,27,239,161,56,239,192,2,1,224,1,56,205,255,42,34,104,92,43,126,203,254,1,6,0,9,7,56,6,14,13,205,85,22,35,229,239,2,2,56,225,235,14,10,237,176,42,69,92,235,115,35,114,253,86,13,20,35,114,205,218,29,208,253,70,56,42,69,92,34,66,92,58,71,92,237,68,87,42,93,92,30,243,197,237,75,85,92,205,134,29,237,67,85,92,193,56,17,231,246,32,184,40,3,231,24,232,231,62,1,146,50,68,92,201,207,17,126,254,58,40,24,35,126,230,192,55,192,70,35,78,237,67,66,92,35,78,35,70,229,9,68,77,225,22,0,197,205,139,25,193,208,24,224,253,203,55,78,194,46,28,42,77,92,203,126,40,31,35,34,104,92,239,224,226,15,192,2,56,205,218,29,216,42,104,92,17,15,0,25,94,35,86,35,102,235,195,115,30,207,0,239,225,224,226,54,0,2,1,3,55,0,4,56,167,201,56,55,201,231,205,31,28,205,48,37,40,41,223,34,95,92,42,87,92,126,254,44,40,9,30,228,205,134,29,48,2,207,13,205,119,0,205,86,28,223,34,87,92,42,95,92,253,54,38,0,205,120,0,223,254,44,40,201,205,238,27,201,205,48,37,32,11,205,251,36,254,44,196,238,27,231,24,245,62,228,71,237,185,17,0,2,195,139,25,205,153,30,96,105,205,110,25,43,34,87,92,201,205,153,30,120,177,32,4,237,75,120,92,237,67,118,92,201,42,110,92,253,86,54,24,12,205,153,30,96,105,22,0,124,254,240,48,44,34,66,92,253,114,10,201,205,133,30,237,121,201,205,133,30,2,201,205,213,45,56,21,40,2,237,68,245,205,153,30,241,201,205,213,45,24,3,205,162,45,56,1,200,207,10,205,103,30,1,0,0,205,69,30,24,3,205,153,30,120,177,32,4,237,75,178,92,197,237,91,75,92,42,89,92,43,205,229,25,205,107,13,42,101,92,17,50,0,25,209,237,82,48,8,42,180,92,167,237,82,48,2,207,21,235,34,178,92,209,193,54,62,43,249,197,237,115,61,92,235,233,209,253,102,13,36,227,51,237,75,69,92,197,229,237,115,61,92,213,205,103,30,1,20,0,42,101,92,9,56,10,235,33,80,0,25,56,3,237,114,216,46,3,195,85,0,1,0,0,205,5,31,68,77,201,193,225,209,122,254,62,40,11,59,227,235,237,115,61,92,197,195,115,30,213,229,207,6,205,153,30,118,11,120,177,40,12,120,161,60,32,1,3,253,203,1,110,40,238,253,203,1,174,201,62,127,219,254,31,216,62,254,219,254,31,201,205,48,37,40,5,62,206,195,57,30,253,203,1,246,205,141,44,48,22,231,254,36,32,5,253,203,1,182,231,254,40,32,60,231,254,41,40,32,205,141,44,210,138,28,235,231,254,36,32,2,235,231,235,1,6,0,205,85,22,35,35,54,14,254,44,32,3,231,24,224,254,41,32,19,231,254,61,32,14,231,58,59,92,245,205,251,36,241,253,174,1,230,64,194,138,28,205,238,27,205,48,37,225,200,233,62,3,24,2,62,2,205,48,37,196,1,22,205,77,13,205,223,31,205,238,27,201,223,205,69,32,40,13,205,78,32,40,251,205,252,31,205,78,32,40,243,254,41,200,205,195,31,62,13,215,201,223,254,172,32,13,205,121,28,205,195,31,205,7,35,62,22,24,16,254,173,32,18,231,205,130,28,205,195,31,205,153,30,62,23,215,121,215,120,215,201,205,242,33,208,205,112,32,208,205,251,36,205,195,31,253,203,1,118,204,241,43,194,227,45,120,177,11,200,26,19,215,24,247,254,41,200,254,13,200,254,58,201,223,254,59,40,20,254,44,32,10,205,48,37,40,11,62,6,215,24,6,254,39,192,205,245,31,231,205,69,32,32,1,193,191,201,254,35,55,192,231,205,130,28,167,205,195,31,205,148,30,254,16,210,14,22,205,1,22,167,201,205,48,37,40,8,62,1,205,1,22,205,110,13,253,54,2,1,205,193,32,205,238,27,237,75,136,92,58,107,92,184,56,3,14,33,71,237,67,136,92,62,25,144,50,140,92,253,203,2,134,205,217,13,195,110,13,205,78,32,40,251,254,40,32,14,231,205,223,31,223,254,41,194,138,28,231,195,178,33,254,202,32,17,231,205,31,28,253,203,55,254,253,203,1,118,194,138,28,24,13,205,141,44,210,175,33,205,31,28,253,203,55,190,205,48,37,202,178,33,205,191,22,33,113,92,203,182,203,238,1,1,0,203,126,32,11,58,59,92,230,64,32,2,14,3,182,119,247,54,13,121,15,15,48,5,62,34,18,43,119,34,91,92,253,203,55,126,32,44,42,93,92,229,42,61,92,229,33,58,33,229,253,203,48,102,40,4,237,115,61,92,42,97,92,205,167,17,253,54,0,255,205,44,15,253,203,1,190,205,185,33,24,3,205,44,15,253,54,34,0,205,214,33,32,10,205,29,17,237,75,130,92,205,217,13,33,113,92,203,174,203,126,203,190,32,28,225,225,34,61,92,225,34,95,92,253,203,1,254,205,185,33,42,95,92,253,54,38,0,34,93,92,24,23,42,99,92,237,91,97,92,55,237,82,68,77,205,178,42,205,255,42,24,3,205,252,31,205,78,32,202,193,32,201,42,97,92,34,93,92,223,254,226,40,12,58,113,92,205,89,28,223,254,13,200,207,11,205,48,37,200,207,16,42,81,92,35,35,35,35,126,254,75,201,231,205,242,33,216,223,254,44,40,246,254,59,40,242,195,138,28,254,217,216,254,223,63,216,245,231,241,214,201,245,205,130,28,241,167,205,195,31,245,205,148,30,87,241,215,122,215,201,214,17,206,0,40,29,214,2,206,0,40,86,254,1,122,6,1,32,4,7,7,6,4,79,122,254,2,48,22,121,33,145,92,24,56,122,6,7,56,5,7,7,7,6,56,79,122,254,10,56,2,207,19,33,143,92,254,8,56,11,126,40,7,176,47,230,36,40,1,120,79,121,205,108,34,62,7,186,159,205,108,34,7,7,230,80,71,62,8,186,159,174,160,174,119,35,120,201,159,122,15,6,128,32,3,15,6,64,79,122,254,8,40,4,254,2,48,189,121,33,143,92,205,108,34,121,15,15,15,24,216,205,148,30,254,8,48,169,211,254,7,7,7,203,111,32,2,238,7,50,72,92,201,62,175,144,218,249,36,71,167,31,55,31,167,31,168,230,248,168,103,121,7,7,7,168,230,199,168,7,7,111,121,230,7,201,205,7,35,205,170,34,71,4,126,7,16,253,230,1,195,40,45,205,7,35,205,229,34,195,77,13,237,67,125,92,205,170,34,71,4,62,254,15,16,253,71,126,253,78,87,203,65,32,1,160,203,81,32,2,168,47,119,195,219,11,205,20,35,71,197,205,20,35,89,193,81,79,201,205,213,45,218,249,36,14,1,200,14,255,201,223,254,44,194,138,28,231,205,130,28,205,238,27,239,42,61,56,126,254,129,48,5,239,2,56,24,161,239,163,56,54,131,239,197,2,56,205,125,36,197,239,49,225,4,56,126,254,128,48,8,239,2,2,56,193,195,220,34,239,194,1,192,2,3,1,224,15,192,1,49,224,1,49,224,160,193,2,56,253,52,98,205,148,30,111,229,205,148,30,225,103,34,125,92,193,195,32,36,223,254,44,40,6,205,238,27,195,119,36,231,205,130,28,205,238,27,239,197,162,4,31,49,48,48,0,6,2,56,195,119,36,192,2,193,2,49,42,225,1,225,42,15,224,5,42,224,1,61,56,126,254,129,48,7,239,2,2,56,195,119,36,205,125,36,197,239,2,225,1,5,193,2,1,49,225,4,194,2,1,49,225,4,226,229,224,3,162,4,49,31,197,2,32,192,2,194,2,193,229,4,224,226,4,15,225,1,193,2,224,4,226,229,4,3,194,42,225,42,15,2,56,26,254,129,193,218,119,36,197,239,1,56,58,125,92,205,40,45,239,192,15,1,56,58,126,92,205,40,45,239,197,15,224,229,56,193,5,40,60,24,20,239,225,49,227,4,226,228,4,3,193,2,228,4,226,227,4,15,194,2,56,197,239,192,2,225,15,49,56,58,125,92,205,40,45,239,3,224,226,15,192,1,224,56,58,126,92,205,40,45,239,3,56,205,183,36,193,16,198,239,2,2,1,56,58,125,92,205,40,45,239,3,1,56,58,126,92,205,40,45,239,3,56,205,183,36,195,77,13,239,49,40,52,50,0,1,5,229,1,5,42,56,205,213,45,56,6,230,252,198,4,48,2,62,252,245,205,40,45,239,229,1,5,49,31,196,2,49,162,4,31,193,1,192,2,49,4,49,15,161,3,27,195,2,56,193,201,205,7,35,121,184,48,6,105,213,175,95,24,7,177,200,104,65,213,22,0,96,120,31,133,56,3,188,56,7,148,79,217,193,197,24,4,79,213,217,193,42,125,92,120,132,71,121,60,133,56,13,40,13,61,79,205,229,34,217,121,16,217,209,201,40,243,207,10,223,6,0,197,79,33,150,37,205,220,22,121,210,132,38,6,0,78,9,233,205,116,0,3,254,13,202,138,28,254,34,32,243,205,116,0,254,34,201,231,254,40,32,6,205,121,28,223,254,41,194,138,28,253,203,1,126,201,205,7,35,42,54,92,17,0,1,25,121,15,15,15,230,224,168,95,121,230,24,238,64,87,6,96,197,213,229,26,174,40,4,60,32,26,61,79,6,7,20,35,26,174,169,32,15,16,247,193,193,193,62,128,144,1,1,0,247,18,24,10,225,17,8,0,25,209,193,16,211,72,195,178,42,205,7,35,121,15,15,15,79,230,224,168,111,121,230,3,238,88,103,126,195,40,45,34,28,40,79,46,242,43,18,168,86,165,87,167,132,166,143,196,230,170,191,171,199,169,206,0,231,195,255,36,223,35,229,1,0,0,205,15,37,32,27,205,15,37,40,251,205,48,37,40,17,247,225,213,126,35,18,19,254,34,32,248,126,35,254,34,40,242,11,209,33,59,92,203,182,203,126,196,178,42,195,18,39,231,205,251,36,254,41,194,138,28,231,195,18,39,195,189,39,205,48,37,40,40,237,75,118,92,205,43,45,239,161,15,52,55,22,4,52,128,65,0,0,128,50,2,161,3,49,56,205,162,45,237,67,118,92,126,167,40,3,214,16,119,24,9,205,48,37,40,4,239,163,56,52,231,195,195,38,1,90,16,231,254,35,202,13,39,33,59,92,203,182,203,126,40,31,205,142,2,14,0,32,19,205,30,3,48,14,21,95,205,51,3,245,1,1,0,247,241,18,14,1,6,0,205,178,42,195,18,39,205,34,37,196,53,37,231,195,219,37,205,34,37,196,128,37,231,24,72,205,34,37,196,203,34,231,24,63,205,136,44,48,86,254,65,48,60,205,48,37,32,35,205,155,44,223,1,6,0,205,85,22,35,54,14,35,235,42,101,92,14,5,167,237,66,34,101,92,237,176,235,43,205,119,0,24,14,223,35,126,254,14,32,250,35,205,180,51,34,93,92,253,203,1,246,24,20,205,178,40,218,46,28,204,150,41,58,59,92,254,192,56,4,35,205,180,51,24,51,1,219,9,254,45,40,39,1,24,16,254,174,40,32,214,175,218,138,28,1,240,4,254,20,40,20,210,138,28,6,16,198,220,79,254,223,48,2,203,177,254,238,56,2,203,185,197,231,195,255,36,223,254,40,32,12,253,203,1,118,32,23,205,82,42,231,24,240,6,0,79,33,149,39,205,220,22,48,6,78,33,237,38,9,70,209,122,184,56,58,167,202,24,0,197,33,59,92,123,254,237,32,6,203,118,32,2,30,153,213,205,48,37,40,9,123,230,63,71,239,59,56,24,9,123,253,174,1,230,64,194,138,28,209,33,59,92,203,246,203,123,32,2,203,182,193,24,193,213,121,253,203,1,118,32,21,230,63,198,8,79,254,16,32,4,203,241,24,8,56,215,254,23,40,2,203,249,197,231,195,255,36,43,207,45,195,42,196,47,197,94,198,61,206,62,204,60,205,199,201,200,202,201,203,197,199,198,200,0,6,8,8,10,2,3,5,5,5,5,5,5,6,205,48,37,32,53,231,205,141,44,210,138,28,231,254,36,245,32,1,231,254,40,32,18,231,254,41,40,16,205,251,36,223,254,44,32,3,231,24,245,254,41,194,138,28,231,33,59,92,203,182,241,40,2,203,246,195,18,39,231,230,223,71,231,214,36,79,32,1,231,231,229,42,83,92,43,17,206,0,197,205,134,29,193,48,2,207,24,229,205,171,40,230,223,184,32,8,205,171,40,214,36,185,40,12,225,43,17,0,2,197,205,139,25,193,24,215,167,204,171,40,209,209,237,83,93,92,205,171,40,229,254,41,40,66,35,126,254,14,22,64,40,7,43,205,171,40,35,22,0,35,229,213,205,251,36,241,253,174,1,230,64,32,43,225,235,42,101,92,1,5,0,237,66,34,101,92,237,176,235,43,205,171,40,254,41,40,13,229,223,254,44,32,13,231,225,205,171,40,24,190,229,223,254,41,40,2,207,25,209,235,34,93,92,42,11,92,227,34,11,92,213,231,231,205,251,36,225,34,93,92,225,34,11,92,231,195,18,39,35,126,254,33,56,250,201,253,203,1,246,223,205,141,44,210,138,28,229,230,31,79,231,229,254,40,40,40,203,241,254,36,40,17,203,233,205,136,44,48,15,205,136,44,48,22,203,177,231,24,246,231,253,203,1,182,58,12,92,167,40,6,205,48,37,194,81,41,65,205,48,37,32,8,121,230,224,203,255,79,24,55,42,75,92,126,230,127,40,45,185,32,34,23,135,242,63,41,56,48,209,213,229,35,26,19,254,32,40,250,246,32,190,40,244,246,128,190,32,6,26,205,136,44,48,21,225,197,205,184,25,235,193,24,206,203,248,209,223,254,40,40,9,203,232,24,13,209,209,209,229,223,205,136,44,48,3,231,24,248,225,203,16,203,112,201,42,11,92,126,254,41,202,239,40,126,246,96,71,35,126,254,14,40,7,43,205,171,40,35,203,168,120,185,40,18,35,35,35,35,35,205,171,40,254,41,202,239,40,205,171,40,24,217,203,105,32,12,35,237,91,101,92,205,192,51,235,34,101,92,209,209,175,60,201,175,71,203,121,32,75,203,126,32,14,60,35,78,35,70,35,235,205,178,42,223,195,73,42,35,35,35,70,203,113,40,10,5,40,232,235,223,254,40,32,97,235,235,24,36,229,223,225,254,44,40,32,203,121,40,82,203,113,32,6,254,41,32,60,231,201,254,41,40,108,254,204,32,50,223,43,34,93,92,24,94,33,0,0,229,231,225,121,254,192,32,9,223,254,41,40,81,254,204,40,229,197,229,205,238,42,227,235,205,204,42,56,25,11,205,244,42,9,209,193,16,179,203,121,32,102,229,203,113,32,19,66,75,223,254,41,40,2,207,2,231,225,17,5,0,205,244,42,9,201,205,238,42,227,205,244,42,193,9,35,66,75,235,205,177,42,223,254,41,40,7,254,44,32,219,205,82,42,231,254,40,40,248,253,203,1,182,201,205,48,37,196,241,43,231,254,41,40,80,213,175,245,197,17,1,0,223,225,254,204,40,23,241,205,205,42,245,80,89,229,223,225,254,204,40,9,254,41,194,138,28,98,107,24,19,229,231,225,254,41,40,12,241,205,205,42,245,223,96,105,254,41,32,230,241,227,25,43,227,167,237,82,1,0,0,56,7,35,167,250,32,42,68,77,209,253,203,1,182,205,48,37,200,175,253,203,1,182,197,205,169,51,193,42,101,92,119,35,115,35,114,35,113,35,112,35,34,101,92,201,175,213,229,245,205,130,28,241,205,48,37,40,18,245,205,153,30,209,120,177,55,40,5,225,229,167,237,66,122,222,0,225,209,201,235,35,94,35,86,201,205,48,37,200,205,169,48,218,21,31,201,42,77,92,253,203,55,78,40,94,1,5,0,3,35,126,254,32,40,250,48,11,254,16,56,17,254,22,48,13,35,24,237,205,136,44,56,231,254,36,202,192,43,121,42,89,92,43,205,85,22,35,35,235,213,42,77,92,27,214,6,71,40,17,35,126,254,33,56,250,246,32,19,18,16,244,246,128,18,62,192,42,77,92,174,246,32,225,205,234,43,229,239,2,56,225,1,5,0,167,237,66,24,64,253,203,1,118,40,6,17,6,0,25,24,231,42,77,92,237,75,114,92,253,203,55,70,32,48,120,177,200,229,247,213,197,84,93,35,54,32,237,184,229,205,241,43,225,227,167,237,66,9,48,2,68,77,227,235,120,177,40,2,237,176,193,209,225,235,120,177,200,213,237,176,225,201,43,43,43,126,229,197,205,198,43,193,225,3,3,3,195,232,25,62,223,42,77,92,166,245,205,241,43,235,9,197,43,34,77,92,3,3,3,42,89,92,43,205,85,22,42,77,92,193,197,3,237,184,235,35,193,112,43,113,241,43,119,42,89,92,43,201,42,101,92,43,70,43,78,43,86,43,94,43,126,34,101,92,201,205,178,40,194,138,28,205,48,37,32,8,203,177,205,150,41,205,238,27,56,8,197,205,184,25,205,232,25,193,203,249,6,0,197,33,1,0,203,113,32,2,46,5,235,231,38,255,205,204,42,218,32,42,225,197,36,229,96,105,205,244,42,235,223,254,44,40,232,254,41,32,187,231,193,121,104,38,0,35,35,41,25,218,21,31,213,197,229,68,77,42,89,92,43,205,85,22,35,119,193,11,11,11,35,113,35,112,193,120,35,119,98,107,27,54,0,203,113,40,2,54,32,193,237,184,193,112,43,113,43,61,32,248,201,205,27,45,63,216,254,65,63,208,254,91,216,254,97,63,208,254,123,201,254,196,32,25,17,0,0,231,214,49,206,0,32,10,235,63,237,106,218,173,49,235,24,239,66,75,195,43,45,254,46,40,15,205,59,45,254,46,32,40,231,205,27,45,56,34,24,10,231,205,27,45,218,138,28,239,160,56,239,161,192,2,56,223,205,34,45,56,11,239,224,164,5,192,4,15,56,231,24,239,254,69,40,3,254,101,192,6,255,231,254,43,40,5,254,45,32,2,4,231,205,27,45,56,203,197,205,59,45,205,213,45,193,218,173,49,167,250,173,49,4,40,2,237,68,195,79,45,254,48,216,254,58,63,201,205,27,45,216,214,48,79,6,0,253,33,58,92,175,95,81,72,71,205,182,42,239,56,167,201,245,239,160,56,241,205,34,45,216,239,1,164,4,15,56,205,116,0,24,241,7,15,48,2,47,60,245,33,146,92,205,11,53,239,164,56,241,203,63,48,13,245,239,193,224,0,4,4,51,2,5,225,56,241,40,8,245,239,49,4,56,241,24,229,239,2,56,201,35,78,35,126,169,145,95,35,126,137,169,87,201,14,0,229,54,0,35,113,35,123,169,145,119,35,122,137,169,119,35,54,0,225,201,239,56,126,167,40,5,239,162,15,39,56,239,2,56,229,213,235,70,205,127,45,175,144,203,121,66,75,123,209,225,201,87,23,159,95,79,175,71,205,182,42,239,52,239,26,32,154,133,4,39,56,205,162,45,216,245,5,4,40,3,241,55,201,241,201,239,49,54,0,11,49,55,0,13,2,56,62,48,215,201,42,56,62,45,215,239,160,195,196,197,2,56,217,229,217,239,49,39,194,3,226,1,194,2,56,126,167,32,71,205,127,45,6,16,122,167,32,6,179,40,9,83,6,8,213,217,209,217,24,87,239,226,56,126,214,126,205,193,45,87,58,172,92,146,50,172,92,122,205,79,45,239,49,39,193,3,225,56,205,213,45,229,50,161,92,61,23,159,60,33,171,92,119,35,134,119,225,195,207,46,214,128,254,28,56,19,205,193,45,214,7,71,33,172,92,134,119,120,237,68,205,79,45,24,146,235,205,186,47,217,203,250,125,217,214,128,71,203,35,203,18,217,203,19,203,18,217,33,170,92,14,5,126,143,39,119,43,13,32,248,16,231,175,33,166,92,17,161,92,6,9,237,111,14,255,237,111,32,4,13,12,32,10,18,19,253,52,113,253,52,114,14,0,203,64,40,1,35,16,231,58,171,92,214,9,56,10,253,53,113,62,4,253,190,111,24,65,239,2,226,56,235,205,186,47,217,62,128,149,46,0,203,250,217,205,221,47,253,126,113,254,8,56,6,217,203,18,217,24,32,1,0,2,123,205,139,47,95,122,205,139,47,87,197,217,193,16,241,33,161,92,121,253,78,113,9,119,253,52,113,24,211,245,33,161,92,253,78,113,6,0,9,65,241,43,126,206,0,119,167,40,5,254,10,63,48,8,16,241,54,1,4,253,52,114,253,112,113,239,2,56,217,225,217,237,75,171,92,33,161,92,120,254,9,56,4,254,252,56,38,167,204,239,21,175,144,250,82,47,71,24,12,121,167,40,3,126,35,13,205,239,21,16,244,121,167,200,4,62,46,215,62,48,16,251,65,24,230,80,21,6,1,205,74,47,62,69,215,74,121,167,242,131,47,237,68,79,62,45,24,2,62,43,215,6,0,195,27,26,213,111,38,0,93,84,41,41,25,41,89,25,76,125,209,201,126,54,0,167,200,35,203,126,203,254,43,200,197,1,5,0,9,65,79,55,43,126,47,206,0,119,16,248,121,193,201,229,245,78,35,70,119,35,121,78,197,35,78,35,70,235,87,94,213,35,86,35,94,213,217,209,225,193,217,35,86,35,94,241,225,201,167,200,254,33,48,22,197,71,217,203,45,203,26,203,27,217,203,26,203,27,16,242,193,208,205,4,48,192,217,175,46,0,87,93,217,17,0,0,201,28,192,20,192,217,28,32,1,20,217,201,235,205,110,52,235,26,182,32,38,213,35,229,35,94,35,86,35,35,35,126,35,78,35,70,225,235,9,235,142,15,206,0,32,11,159,119,35,115,35,114,43,43,43,209,201,43,209,205,147,50,217,229,217,213,229,205,155,47,71,235,205,155,47,79,184,48,3,120,65,235,245,144,205,186,47,205,221,47,241,225,119,229,104,97,25,217,235,237,74,235,124,141,111,31,173,217,235,225,31,48,8,62,1,205,221,47,52,40,35,217,125,230,128,217,35,119,43,40,31,123,237,68,63,95,122,47,206,0,87,217,123,47,206,0,95,122,47,206,0,48,7,31,217,52,202,173,49,217,87,217,175,195,85,49,197,6,16,124,77,33,0,0,41,56,10,203,17,23,48,3,25,56,2,16,243,193,201,205,233,52,216,35,174,203,254,43,201,26,182,32,34,213,229,213,205,127,45,235,227,65,205,127,45,120,169,79,225,205,169,48,235,225,56,10,122,179,32,1,79,205,142,45,209,201,209,205,147,50,175,205,192,48,216,217,229,217,213,235,205,192,48,235,56,90,229,205,186,47,120,167,237,98,217,229,237,98,217,6,33,24,17,48,5,25,217,237,90,217,217,203,28,203,29,217,203,28,203,29,217,203,24,203,25,217,203,25,31,16,228,235,217,235,217,193,225,120,129,32,1,167,61,63,23,63,31,242,70,49,48,104,167,60,32,8,56,6,217,203,122,217,32,92,119,217,120,217,48,21,126,167,62,128,40,1,175,217,162,205,251,47,7,119,56,46,35,119,43,24,41,6,32,217,203,122,217,32,18,7,203,19,203,18,217,203,19,203,18,217,53,40,215,16,234,24,215,23,48,12,205,4,48,32,7,217,22,128,217,52,40,24,229,35,217,213,217,193,120,23,203,22,31,119,35,113,35,114,35,115,225,209,217,225,217,201,207,5,205,147,50,235,175,205,192,48,56,244,235,205,192,48,216,217,229,217,213,229,205,186,47,217,229,96,105,217,97,104,175,6,223,24,16,23,203,17,217,203,17,203,16,217,41,217,237,106,217,56,16,237,82,217,237,82,217,48,15,25,217,237,90,217,167,24,8,167,237,82,217,237,82,217,55,4,250,210,49,245,40,225,95,81,217,89,80,241,203,24,241,203,24,217,193,225,120,145,195,61,49,126,167,200,254,129,48,6,54,0,62,32,24,81,254,145,32,26,35,35,35,62,128,166,43,182,43,32,3,62,128,174,43,32,54,119,35,54,255,43,62,24,24,51,48,44,213,47,198,145,35,86,35,94,43,43,14,0,203,122,40,1,13,203,250,6,8,144,128,56,4,90,22,0,144,40,7,71,203,58,203,27,16,250,205,142,45,209,201,126,214,160,240,237,68,213,235,43,71,203,56,203,56,203,56,40,5,54,0,43,16,251,230,7,40,9,71,62,255,203,39,16,252,166,119,235,209,201,205,150,50,235,126,167,192,213,205,127,45,175,35,119,43,119,6,145,122,167,32,8,179,66,40,16,83,88,6,137,235,5,41,48,252,203,9,203,28,203,29,235,43,115,43,114,43,112,209,201,0,176,0,64,176,0,1,48,0,241,73,15,218,162,64,176,0,10,143,54,60,52,161,51,15,48,202,48,175,49,81,56,27,53,36,53,59,53,59,53,59,53,59,53,59,53,59,53,20,48,45,53,59,53,59,53,59,53,59,53,59,53,59,53,156,53,222,53,188,52,69,54,110,52,105,54,222,53,116,54,181,55,170,55,218,55,51,56,67,56,226,55,19,55,196,54,175,54,74,56,146,52,106,52,172,52,165,52,179,52,31,54,201,53,1,53,192,51,160,54,134,54,198,51,122,54,6,53,249,52,155,54,131,55,20,50,162,51,79,45,151,50,73,52,27,52,45,52,15,52,205,191,53,120,50,103,92,217,227,217,237,83,101,92,217,126,35,229,167,242,128,51,87,230,96,15,15,15,15,198,124,111,122,230,31,24,14,254,24,48,8,217,1,251,255,84,93,9,217,7,111,17,215,50,38,0,25,94,35,86,33,101,51,227,213,217,237,75,102,92,201,241,58,103,92,217,24,195,213,229,1,5,0,205,5,31,225,209,201,237,91,101,92,205,192,51,237,83,101,92,201,205,169,51,237,176,201,98,107,205,169,51,217,229,217,227,197,126,230,192,7,7,79,12,126,230,63,32,2,35,126,198,80,18,62,5,145,35,19,6,0,237,176,193,227,217,225,217,71,175,5,200,18,19,24,250,167,200,245,213,17,0,0,205,200,51,209,241,61,24,242,79,7,7,129,79,6,0,9,201,213,42,104,92,205,6,52,205,192,51,225,201,98,107,217,229,33,197,50,217,205,247,51,205,200,51,217,225,217,201,229,235,42,104,92,205,6,52,235,205,192,51,235,225,201,6,5,26,78,235,18,113,35,19,16,247,235,201,71,205,94,51,49,15,192,2,160,194,49,224,4,226,193,3,56,205,198,51,205,98,51,15,1,194,2,53,238,225,3,56,201,6,255,24,6,205,233,52,216,6,0,126,167,40,11,35,120,230,128,182,23,63,31,119,43,201,213,229,205,127,45,225,120,177,47,79,205,142,45,209,201,205,233,52,216,213,17,1,0,35,203,22,43,159,79,205,142,45,209,201,205,153,30,237,120,24,4,205,153,30,10,195,40,45,205,153,30,33,43,45,229,197,201,205,241,43,11,120,177,32,35,26,205,141,44,56,9,214,144,56,25,254,21,48,21,60,61,135,135,135,254,168,48,12,237,75,123,92,129,79,48,1,4,195,43,45,207,9,229,197,71,126,35,182,35,182,35,182,120,193,225,192,55,201,205,233,52,216,62,255,24,6,205,233,52,24,5,175,35,174,43,7,229,62,0,119,35,119,35,23,119,31,35,119,35,119,225,201,235,205,233,52,235,216,55,24,231,235,205,233,52,235,208,167,24,222,235,205,233,52,235,208,213,27,175,18,27,18,209,201,120,214,8,203,87,32,1,61,15,48,8,245,229,205,60,52,209,235,241,203,87,32,7,15,245,205,15,48,24,51,15,245,205,241,43,213,197,205,241,43,225,124,181,227,120,32,11,177,193,40,4,241,63,24,22,241,24,19,177,40,13,26,150,56,9,32,237,11,19,35,227,43,24,223,193,241,167,245,239,160,56,241,245,220,1,53,241,245,212,249,52,241,15,212,1,53,201,205,241,43,213,197,205,241,43,225,229,213,197,9,68,77,247,205,178,42,193,225,120,177,40,2,237,176,193,225,120,177,40,2,237,176,42,101,92,17,251,255,229,25,209,201,205,213,45,56,14,32,12,245,1,1,0,247,241,18,205,178,42,235,201,207,10,42,93,92,229,120,198,227,159,245,205,241,43,213,3,247,225,237,83,93,92,213,237,176,235,43,54,13,253,203,1,190,205,251,36,223,254,13,32,7,225,241,253,174,1,230,64,194,138,28,34,93,92,253,203,1,254,205,251,36,225,34,93,92,24,160,1,1,0,247,34,91,92,229,42,81,92,229,62,255,205,1,22,205,227,45,225,205,21,22,209,42,91,92,167,237,82,68,77,205,178,42,235,201,205,148,30,254,16,210,159,30,42,81,92,229,205,1,22,205,230,21,1,0,0,48,3,12,247,18,205,178,42,225,205,21,22,195,191,53,205,241,43,120,177,40,1,26,195,40,45,205,241,43,195,43,45,217,229,33,103,92,53,225,32,4,35,217,201,217,94,123,23,159,87,25,217,201,19,19,26,27,27,167,32,239,217,35,217,201,241,217,227,217,201,239,192,2,49,224,5,39,224,1,192,4,3,224,56,201,239,49,54,0,4,58,56,201,49,58,192,3,224,1,48,0,3,161,3,56,201,239,61,52,241,56,170,59,41,4,49,39,195,3,49,15,161,3,136,19,54,88,101,102,157,120,101,64,162,96,50,201,231,33,247,175,36,235,47,176,176,20,238,126,187,148,88,241,58,126,248,207,227,56,205,213,45,32,7,56,3,134,48,9,207,5,56,7,150,48,4,237,68,119,201,239,2,160,56,201,239,61,49,55,0,4,56,207,9,160,2,56,126,54,128,205,40,45,239,52,56,0,3,1,49,52,240,76,204,204,205,3,55,0,8,1,161,3,1,56,52,239,1,52,240,49,114,23,248,4,1,162,3,162,3,49,52,50,32,4,162,3,140,17,172,20,9,86,218,165,89,48,197,92,144,170,158,112,111,97,161,203,218,150,164,49,159,180,231,160,254,92,252,234,27,67,202,54,237,167,156,126,94,240,110,35,128,147,4,15,56,201,239,61,52,238,34,249,131,110,4,49,162,15,39,3,49,15,49,15,49,42,161,3,49,55,192,0,4,2,56,201,161,3,1,54,0,2,27,56,201,239,57,42,161,3,224,0,6,27,51,3,239,57,49,49,4,49,15,161,3,134,20,230,92,31,11,163,143,56,238,233,21,99,187,35,238,146,13,205,237,241,35,93,27,234,4,56,201,239,49,31,1,32,5,56,201,205,151,50,126,254,129,56,14,239,161,27,1,5,49,54,163,1,0,6,27,51,3,239,160,1,49,49,4,49,15,161,3,140,16,178,19,14,85,228,141,88,57,188,91,152,253,158,0,54,117,160,219,232,180,99,66,196,230,181,9,54,190,233,54,115,27,93,236,216,222,99,190,240,97,161,179,12,4,15,56,201,239,49,49,4,161,3,27,40,161,15,5,36,49,15,56,201,239,34,163,3,27,56,201,239,49,48,0,30,162,56,239,1,49,48,0,7,37,4,56,195,196,54,2,49,48,0,9,160,1,55,0,6,161,1,5,2,161,56,201,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,0,0,0,0,0,0,0,0,0,16,16,16,16,0,16,0,0,36,36,0,0,0,0,0,0,36,126,36,36,126,36,0,0,8,62,40,62,10,62,8,0,98,100,8,16,38,70,0,0,16,40,16,42,68,58,0,0,8,16,0,0,0,0,0,0,4,8,8,8,8,4,0,0,32,16,16,16,16,32,0,0,0,20,8,62,8,20,0,0,0,8,8,62,8,8,0,0,0,0,0,0,8,8,16,0,0,0,0,62,0,0,0,0,0,0,0,0,24,24,0,0,0,2,4,8,16,32,0,0,60,70,74,82,98,60,0,0,24,40,8,8,8,62,0,0,60,66,2,60,64,126,0,0,60,66,12,2,66,60,0,0,8,24,40,72,126,8,0,0,126,64,124,2,66,60,0,0,60,64,124,66,66,60,0,0,126,2,4,8,16,16,0,0,60,66,60,66,66,60,0,0,60,66,66,62,2,60,0,0,0,0,16,0,0,16,0,0,0,16,0,0,16,16,32,0,0,4,8,16,8,4,0,0,0,0,62,0,62,0,0,0,0,16,8,4,8,16,0,0,60,66,4,8,0,8,0,0,60,74,86,94,64,60,0,0,60,66,66,126,66,66,0,0,124,66,124,66,66,124,0,0,60,66,64,64,66,60,0,0,120,68,66,66,68,120,0,0,126,64,124,64,64,126,0,0,126,64,124,64,64,64,0,0,60,66,64,78,66,60,0,0,66,66,126,66,66,66,0,0,62,8,8,8,8,62,0,0,2,2,2,66,66,60,0,0,68,72,112,72,68,66,0,0,64,64,64,64,64,126,0,0,66,102,90,66,66,66,0,0,66,98,82,74,70,66,0,0,60,66,66,66,66,60,0,0,124,66,66,124,64,64,0,0,60,66,66,82,74,60,0,0,124,66,66,124,68,66,0,0,60,64,60,2,66,60,0,0,254,16,16,16,16,16,0,0,66,66,66,66,66,60,0,0,66,66,66,66,36,24,0,0,66,66,66,66,90,36,0,0,66,36,24,24,36,66,0,0,130,68,40,16,16,16,0,0,126,4,8,16,32,126,0,0,14,8,8,8,8,14,0,0,0,64,32,16,8,4,0,0,112,16,16,16,16,112,0,0,16,56,84,16,16,16,0,0,0,0,0,0,0,0,255,0,28,34,120,32,32,126,0,0,0,56,4,60,68,60,0,0,32,32,60,34,34,60,0,0,0,28,32,32,32,28,0,0,4,4,60,68,68,60,0,0,0,56,68,120,64,60,0,0,12,16,24,16,16,16,0,0,0,60,68,68,60,4,56,0,64,64,120,68,68,68,0,0,16,0,48,16,16,56,0,0,4,0,4,4,4,36,24,0,32,40,48,48,40,36,0,0,16,16,16,16,16,12,0,0,0,104,84,84,84,84,0,0,0,120,68,68,68,68,0,0,0,56,68,68,68,56,0,0,0,120,68,68,120,64,64,0,0,60,68,68,60,4,6,0,0,28,32,32,32,32,0,0,0,56,64,56,4,120,0,0,16,56,16,16,16,12,0,0,0,68,68,68,68,56,0,0,0,68,68,40,40,16,0,0,0,68,84,84,84,40,0,0,0,68,40,16,40,68,0,0,0,68,68,68,60,4,56,0,0,124,8,16,32,124,0,0,14,8,48,8,8,14,0,0,8,8,8,8,8,8,0,0,112,16,12,16,16,112,0,0,20,40,0,0,0,0,0,60,66,153,161,161,153,66,60])};
var MANIC_SNAPSHOT = new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,252,156,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,124,0,16,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,124,0,16,0,0,0,0,0,0,24,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,66,68,56,56,56,0,0,104,104,104,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,66,68,56,56,56,0,0,104,104,40,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,124,68,16,68,64,16,0,84,84,84,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,124,68,16,68,64,16,0,84,84,8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,66,68,16,120,56,0,0,84,84,84,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,66,68,16,120,56,0,0,84,84,8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,66,60,16,64,4,0,0,84,84,84,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,66,60,16,64,4,0,0,84,84,8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,124,4,12,60,120,16,0,84,84,84,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,124,4,12,60,120,16,0,84,84,62,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,56,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,56,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,208,192,192,192,208,192,195,195,195,192,192,192,224,192,192,192,230,198,198,198,198,192,192,192,192,192,192,192,192,192,192,192,208,208,192,208,208,192,192,243,240,240,194,192,224,224,194,192,230,192,192,192,192,192,192,216,216,216,192,192,192,192,192,192,213,192,208,192,213,192,240,195,192,192,242,194,224,192,226,192,230,198,238,238,238,192,220,196,196,196,216,192,192,192,192,192,213,197,192,197,213,192,240,195,192,192,242,192,226,192,194,224,230,192,192,232,192,192,220,192,192,192,196,192,192,192,192,192,213,192,197,192,213,192,243,243,243,240,242,192,224,194,194,192,230,198,198,238,198,192,220,196,196,196,216,192,192,192,192,192,197,192,192,192,197,192,240,192,192,192,242,192,192,192,194,192,192,192,192,232,192,192,196,216,220,216,192,192,192,192,192,192,197,192,192,192,197,192,192,192,192,192,192,192,192,192,192,192,192,192,232,232,232,192,196,192,192,196,196,192,192,192,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,0,62,0,124,0,52,0,62,0,60,0,24,0,60,0,126,0,126,0,247,0,251,0,60,0,118,0,110,0,119,0,1,128,15,128,31,0,13,0,15,128,15,0,6,0,15,0,27,128,27,128,27,128,29,128,15,0,6,0,6,0,7,0,0,96,3,224,7,192,3,64,3,224,3,192,1,128,3,192,7,224,7,224,15,112,15,176,3,192,7,96,6,224,7,112,0,24,0,248,1,240,0,208,0,248,0,240,0,96,0,240,1,248,3,252,7,254,6,246,0,248,1,218,3,14,3,132,24,0,31,0,15,128,11,0,31,0,15,0,6,0,15,0,31,128,63,192,127,224,111,96,31,0,91,128,112,192,33,192,6,0,7,192,3,224,2,192,7,192,3,192,1,128,3,192,7,224,7,224,14,240,13,240,3,192,6,224,7,96,14,224,1,128,1,240,0,248,0,176,1,240,0,240,0,96,0,240,1,248,1,216,1,216,1,184,0,240,0,96,0,96,0,224,0,96,0,124,0,62,0,44,0,124,0,60,0,24,0,60,0,126,0,126,0,239,0,223,0,60,0,110,0,118,0,238,0,96,0,97,0,98,0,99,0,100,0,101,0,102,0,103,32,96,32,97,32,98,32,99,32,100,32,101,32,102,32,103,64,96,64,97,64,98,64,99,64,100,64,101,64,102,64,103,96,96,96,97,96,98,96,99,96,100,96,101,96,102,96,103,128,96,128,97,128,98,128,99,128,100,128,101,128,102,128,103,160,96,160,97,160,98,160,99,160,100,160,101,160,102,160,103,192,96,192,97,192,98,192,99,192,100,192,101,192,102,192,103,224,96,224,97,224,98,224,99,224,100,224,101,224,102,224,103,0,104,0,105,0,106,0,107,0,108,0,109,0,110,0,111,32,104,32,105,32,106,32,107,32,108,32,109,32,110,32,111,64,104,64,105,64,106,64,107,64,108,64,109,64,110,64,111,96,104,96,105,96,106,96,107,96,108,96,109,96,110,96,111,128,104,128,105,128,106,128,107,128,108,128,109,128,110,128,111,160,104,160,105,160,106,160,107,160,108,160,109,160,110,160,111,192,104,192,105,192,106,192,107,192,108,192,109,192,110,192,111,224,104,224,105,224,106,224,107,224,108,224,109,224,110,224,111,243,49,254,156,195,204,133,0,0,1,0,1,1,3,1,3,2,0,2,0,0,1,2,3,65,73,82,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,72,105,103,104,32,83,99,111,114,101,32,48,48,48,48,48,48,32,32,32,83,99,111,114,101,32,48,48,48,48,48,48,71,97,109,101,79,118,101,114,0,0,0,0,0,0,0,31,31,31,15,31,30,27,31,30,31,31,23,31,15,31,29,80,128,129,80,102,103,80,86,87,50,86,87,50,171,203,50,43,51,50,43,51,50,171,203,50,51,64,50,51,64,50,171,203,50,128,129,50,128,129,50,102,103,50,86,87,50,96,86,50,171,192,50,43,48,50,43,48,50,171,192,50,48,68,50,48,68,50,171,192,50,136,137,50,136,137,50,114,115,50,76,77,50,76,77,50,171,192,50,38,48,50,38,48,50,171,192,50,48,68,50,48,68,50,171,192,50,136,137,50,136,137,50,114,115,50,76,77,50,76,77,50,171,203,50,38,51,50,38,51,50,171,203,50,51,64,50,51,64,50,171,203,50,128,129,50,128,129,50,102,103,50,86,87,50,64,65,50,128,171,50,32,43,50,32,43,50,128,171,50,43,51,50,43,51,50,128,171,50,128,129,50,128,129,50,102,103,50,86,87,50,64,65,50,128,152,50,32,38,50,32,38,50,128,152,50,38,48,50,38,48,50,0,0,50,114,115,50,114,115,50,96,97,50,76,77,50,76,153,50,76,77,50,76,77,50,76,153,50,91,92,50,86,87,50,51,205,50,51,52,50,51,52,50,51,205,50,64,65,50,102,103,100,102,103,50,114,115,100,76,77,50,86,87,50,128,203,25,128,0,25,128,129,50,128,203,255,128,114,102,96,86,102,86,86,81,96,81,81,86,102,86,86,128,114,102,96,86,102,86,86,81,96,81,81,86,86,86,86,128,114,102,96,86,102,86,86,81,96,81,81,86,102,86,86,128,114,102,96,86,102,86,64,86,102,128,102,86,86,86,86,175,50,7,132,50,89,132,50,90,132,50,91,132,50,88,132,62,2,50,87,132,33,92,132,203,198,33,0,64,17,1,64,1,255,23,54,0,237,176,33,0,160,17,0,64,1,0,16,237,176,33,61,72,17,64,130,14,0,205,244,143,33,0,252,17,0,88,1,0,1,237,176,33,0,158,1,0,2,237,176,1,31,0,243,175,237,88,179,16,251,230,32,32,5,62,1,50,89,132,253,33,110,132,205,220,146,194,132,134,175,50,220,128,58,220,128,221,33,0,157,221,111,17,96,80,14,32,205,186,146,58,220,128,230,6,15,15,15,95,22,130,33,61,72,14,0,205,244,143,1,100,0,16,254,13,32,251,1,254,191,237,120,230,1,254,1,32,16,58,220,128,60,254,224,50,220,128,32,190,62,64,50,90,132,33,37,132,17,38,132,1,9,0,54,48,237,176,58,7,132,203,39,203,39,198,176,103,46,0,17,0,94,1,0,2,237,176,17,0,128,1,0,2,237,176,205,117,138,33,0,80,17,1,80,1,255,7,54,0,237,176,221,33,0,128,14,32,17,0,80,205,186,146,221,33,24,132,14,3,17,32,80,205,186,146,62,82,103,87,46,36,30,37,71,58,188,128,214,36,79,120,6,0,54,255,237,176,60,254,86,32,231,221,33,47,132,17,96,80,14,32,205,186,146,58,115,128,14,254,237,121,58,90,132,183,40,5,62,64,50,90,132,58,87,132,33,160,80,183,40,25,71,14,0,229,197,58,91,132,7,7,7,230,96,95,22,130,205,244,143,193,225,35,35,16,232,58,93,132,254,7,32,8,17,224,186,14,0,205,244,143,33,0,94,17,0,92,1,0,2,237,176,33,0,112,17,0,96,1,0,16,237,176,205,15,141,58,90,132,183,204,187,138,58,90,132,183,204,58,146,205,170,141,205,5,145,205,99,143,58,7,132,254,4,204,248,141,58,7,132,254,13,202,117,142,58,7,132,254,8,212,241,142,58,7,132,254,7,204,53,145,58,7,132,254,11,204,53,145,58,7,132,254,18,204,115,141,205,197,143,33,0,96,17,0,64,1,0,16,237,176,58,88,132,183,40,21,61,50,88,132,7,7,7,230,56,33,0,92,17,1,92,1,255,1,119,237,176,33,0,92,17,0,88,1,0,2,237,176,221,33,41,132,17,122,80,14,6,205,186,146,221,33,31,132,17,107,80,14,6,205,186,146,205,60,138,202,255,136,1,254,254,237,120,95,6,127,237,120,179,230,1,202,204,133,6,253,237,120,230,31,254,31,40,10,6,2,237,120,230,31,254,31,40,246,58,107,128,254,255,202,255,136,6,191,33,92,132,237,120,230,31,254,31,40,10,203,70,32,8,126,238,3,119,24,2,203,134,203,78,32,37,58,91,132,60,50,91,132,230,126,15,95,22,0,33,140,133,25,58,115,128,94,1,3,0,211,254,29,32,3,94,238,24,16,246,13,32,243,58,90,132,183,40,31,61,202,255,136,50,90,132,1,254,0,237,120,230,31,254,31,194,204,133,58,89,132,183,40,6,219,31,183,194,204,133,1,254,239,237,120,203,103,194,168,136,58,93,132,254,7,194,168,136,6,247,237,120,47,230,31,254,20,210,168,136,50,7,132,195,145,134,58,93,132,254,7,202,14,135,7,95,22,0,221,33,96,132,221,25,1,254,247,237,120,230,31,221,190,0,40,18,254,31,202,14,135,221,190,254,202,14,135,175,50,93,132,195,14,135,6,239,237,120,230,31,221,190,1,40,18,254,31,202,14,135,221,190,255,202,14,135,175,50,93,132,195,14,135,58,93,132,60,50,93,132,195,14,135,58,90,132,183,194,40,144,62,71,33,0,88,17,1,88,1,255,1,119,237,176,95,47,230,7,7,7,7,246,7,87,75,203,9,203,9,203,9,246,16,175,211,254,238,24,66,16,254,13,32,246,123,61,254,63,32,208,33,87,132,126,183,202,68,137,53,195,145,134,33,31,132,17,41,132,6,6,26,190,218,99,137,194,88,137,35,19,16,244,33,41,132,17,31,132,1,6,0,237,176,33,0,64,17,1,64,1,255,15,54,0,237,176,175,50,220,128,17,64,130,33,143,72,14,0,205,244,143,17,224,182,33,207,72,14,0,205,244,143,58,220,128,79,6,131,10,246,15,111,3,10,214,32,103,17,224,186,14,0,205,244,143,58,220,128,47,95,175,1,64,0,211,254,238,24,67,16,254,13,32,246,33,0,88,17,1,88,1,255,1,58,220,128,230,12,7,246,71,119,237,176,58,220,128,198,4,50,220,128,254,196,32,182,221,33,79,132,14,4,17,202,64,205,186,146,221,33,83,132,14,4,17,210,64,205,186,146,1,0,0,22,6,16,254,121,230,7,246,64,50,202,88,60,230,7,246,64,50,203,88,60,230,7,246,64,50,204,88,60,230,7,246,64,50,205,88,60,230,7,246,64,50,210,88,60,230,7,246,64,50,211,88,60,230,7,246,64,50,212,88,60,230,7,246,64,50,213,88,13,32,187,21,32,184,195,204,133,58,189,128,214,4,50,189,128,254,252,32,13,58,188,128,254,36,200,61,50,188,128,58,189,128,230,224,7,7,7,30,0,183,40,7,71,203,11,203,251,16,250,58,188,128,111,38,82,6,4,115,36,16,252,175,60,201,221,33,0,94,62,112,50,156,138,205,138,138,221,33,0,95,62,120,50,156,138,14,0,89,221,126,0,33,32,128,1,72,0,237,177,75,6,8,22,0,126,18,35,20,16,250,221,35,12,194,140,138,58,7,132,254,19,192,33,0,160,17,0,112,1,0,8,237,176,201,58,107,128,254,1,32,78,58,110,128,203,135,214,8,33,104,128,134,119,205,130,139,58,59,128,190,202,162,139,35,190,202,162,139,58,110,128,60,50,110,128,214,8,242,235,138,237,68,60,7,7,7,87,14,32,58,115,128,211,254,238,24,66,16,254,13,32,246,58,110,128,254,18,202,150,139,254,16,40,5,254,13,194,131,140,58,104,128,230,15,32,58,42,108,128,17,64,0,25,58,50,128,190,204,186,139,58,77,128,190,40,38,58,86,128,190,40,32,35,58,50,128,190,204,186,139,58,77,128,190,40,18,58,86,128,190,40,12,58,32,128,190,43,194,221,139,190,194,221,139,58,107,128,254,1,202,131,140,33,106,128,203,142,183,202,156,139,60,50,107,128,7,7,7,7,87,14,32,58,115,128,211,254,238,24,66,16,254,13,32,246,58,104,128,198,8,50,104,128,230,240,111,175,203,21,206,92,103,58,108,128,230,31,181,111,34,108,128,201,62,6,50,107,128,201,62,2,50,107,128,201,58,104,128,198,16,230,240,50,104,128,205,130,139,62,2,50,107,128,33,106,128,203,142,201,77,124,198,27,246,7,71,5,10,4,2,5,120,230,7,32,246,175,2,120,198,7,71,10,183,192,58,32,128,36,36,119,37,37,201,58,107,128,254,12,210,6,141,30,255,175,50,107,128,58,68,128,190,40,4,35,190,32,6,58,111,128,214,3,95,1,254,223,237,120,230,31,246,32,163,95,1,254,251,237,120,230,31,203,7,246,1,163,95,6,247,237,120,15,246,247,163,95,6,239,237,120,246,251,163,95,58,89,132,183,40,10,1,31,0,237,120,230,3,47,163,95,14,0,123,230,42,254,42,40,2,14,4,123,230,21,254,21,40,2,203,217,58,106,128,129,79,6,0,33,8,132,9,126,50,106,128,1,254,126,237,120,230,31,254,31,32,25,6,239,237,120,230,9,254,9,32,15,58,89,132,183,40,17,1,31,0,237,120,203,103,40,8,175,50,110,128,60,50,107,128,58,106,128,230,2,200,58,106,128,230,1,202,202,140,58,105,128,183,40,5,61,50,105,128,201,42,108,128,43,17,32,0,25,58,59,128,190,200,58,104,128,230,15,40,9,58,59,128,25,190,200,183,237,82,58,59,128,183,237,82,190,200,34,108,128,62,3,50,105,128,201,58,105,128,254,3,40,5,60,50,105,128,201,42,108,128,35,35,17,32,0,58,59,128,25,190,200,58,104,128,230,15,40,9,58,59,128,25,190,200,183,237,82,58,59,128,183,237,82,190,200,43,34,108,128,175,50,105,128,201,225,225,62,255,50,107,128,195,162,135,253,33,190,128,17,7,0,253,126,0,254,255,200,183,40,80,58,189,128,230,4,15,15,15,253,166,0,32,67,253,126,4,254,3,40,16,254,4,40,35,48,5,253,52,4,24,49,253,53,4,24,44,253,126,1,253,190,6,32,6,253,54,4,7,24,30,253,54,4,0,253,52,1,24,21,253,126,1,253,190,5,32,6,253,54,4,0,24,7,253,54,4,7,253,53,1,253,25,24,163,33,23,92,17,32,0,58,41,128,190,200,58,59,128,190,200,62,39,190,32,16,217,205,60,138,205,60,138,205,60,138,205,60,138,217,24,13,58,32,128,190,40,7,123,238,223,95,122,47,87,54,119,25,24,207,253,33,190,128,253,126,0,254,255,200,183,40,58,17,31,0,253,110,1,253,102,2,230,127,119,35,119,25,119,35,119,14,1,253,126,4,15,15,15,95,58,7,132,254,7,56,10,254,9,40,6,254,15,40,2,203,251,22,129,253,110,1,253,102,3,205,244,143,194,6,141,17,7,0,253,25,24,182,58,116,128,183,40,17,58,219,128,183,40,11,58,220,128,61,40,18,50,220,128,24,21,58,220,128,60,254,88,40,5,50,220,128,24,8,58,219,128,238,1,50,219,128,58,220,128,230,127,7,95,22,131,26,246,15,111,19,26,103,17,224,128,14,1,205,244,143,194,6,141,58,220,128,230,120,7,246,7,55,203,23,111,62,0,206,92,103,58,116,128,183,62,7,32,7,58,189,128,15,15,230,7,119,58,32,128,230,248,182,119,17,31,0,35,119,25,119,35,119,25,119,35,119,201,253,33,221,128,253,126,0,254,255,202,159,135,253,126,2,253,190,6,48,8,253,134,4,253,119,2,24,30,253,52,1,253,126,1,254,8,32,20,253,126,5,253,119,2,253,126,3,198,8,230,31,253,119,3,253,54,1,0,253,94,2,203,3,22,131,26,253,134,3,111,19,26,103,253,126,1,15,15,15,95,22,129,14,1,205,244,143,194,7,141,253,126,2,230,64,7,7,198,92,103,253,126,2,7,7,230,224,253,182,3,111,253,126,0,205,95,142,17,7,0,253,25,24,136,253,33,221,128,253,126,0,254,255,200,253,52,1,253,203,1,150,253,126,2,253,134,4,253,190,5,56,10,253,190,6,48,5,253,119,2,24,8,253,126,4,237,68,253,119,4,253,126,2,230,127,7,95,22,131,26,253,182,3,111,19,26,103,253,126,1,15,15,15,95,22,129,14,1,205,244,143,194,6,141,253,126,2,230,64,7,7,198,92,103,253,126,2,7,7,230,224,253,182,3,111,253,126,0,205,95,142,17,7,0,253,25,24,146,175,50,116,128,253,33,117,128,253,126,0,254,255,40,72,183,40,57,253,94,1,253,86,2,26,230,7,254,7,32,12,33,44,132,205,254,144,253,54,0,0,24,32,253,126,0,230,248,246,3,71,253,126,0,230,3,128,253,119,0,18,50,116,128,253,86,3,33,180,128,6,8,205,213,146,253,35,253,35,253,35,253,35,253,35,24,177,58,116,128,183,192,33,143,128,203,254,201,42,176,128,58,108,128,189,32,17,58,109,128,188,32,11,58,143,128,203,127,40,4,225,195,40,144,58,143,128,119,35,119,17,31,0,25,119,35,119,17,144,128,42,178,128,14,0,6,16,203,65,26,40,4,166,192,26,182,119,44,19,203,65,26,40,4,166,192,26,182,119,45,36,19,124,230,7,32,16,124,214,8,103,125,198,32,111,230,224,32,4,124,198,8,103,16,208,175,201,58,7,132,60,254,20,32,97,58,90,132,183,194,144,144,58,93,132,254,7,40,82,14,0,17,96,130,33,83,64,205,244,143,17,224,178,33,179,64,205,244,143,33,83,88,17,31,0,54,47,35,54,47,25,54,39,35,54,39,25,35,25,54,69,35,54,69,25,54,70,35,54,71,25,54,0,35,54,0,1,0,0,22,50,175,211,254,238,24,95,121,130,130,130,71,123,16,254,13,32,240,21,32,237,175,50,7,132,62,63,33,0,88,17,1,88,1,255,1,119,237,176,1,4,0,16,254,13,32,251,61,32,233,58,90,132,183,194,145,134,205,60,138,202,145,134,33,46,132,205,254,144,221,33,41,132,14,6,17,122,80,205,186,146,14,4,58,188,128,47,230,63,203,7,87,62,0,211,254,66,16,254,62,24,211,254,66,16,254,13,32,239,24,202,54,48,43,125,254,42,32,12,62,8,50,88,132,58,87,132,60,50,87,132,126,254,57,40,231,52,201,42,112,128,93,84,58,114,128,71,58,111,128,183,32,19,126,203,7,203,7,36,36,78,203,9,203,9,18,113,44,28,16,250,201,126,203,15,203,15,36,36,78,203,1,203,1,24,235,33,6,92,205,27,146,58,219,128,254,2,200,58,6,117,254,16,202,249,145,58,113,95,183,40,39,33,113,127,126,183,32,22,37,124,254,119,32,246,58,32,128,50,113,95,50,145,95,62,114,50,203,128,24,10,54,0,46,145,124,238,7,103,54,0,33,18,92,205,27,146,32,31,175,50,220,128,60,50,219,128,58,32,128,50,79,94,50,80,94,33,79,112,6,8,54,0,44,54,0,45,36,16,247,58,219,128,183,40,86,58,220,128,254,100,40,73,198,4,50,220,128,79,22,16,58,115,128,211,254,238,24,65,16,254,21,32,246,121,7,95,22,131,26,246,15,111,19,26,103,22,129,58,189,128,230,32,246,64,95,14,0,205,244,143,33,44,132,205,254,144,58,220,128,230,120,111,38,23,41,41,125,246,15,111,62,6,195,95,142,62,2,50,219,128,201,58,189,128,230,32,95,22,129,33,15,96,14,1,205,244,143,194,6,141,62,68,50,47,92,50,48,92,50,15,92,50,16,92,201,58,108,128,60,230,254,189,192,58,109,128,188,192,58,101,128,38,117,190,192,54,8,36,54,6,36,54,6,175,183,201,42,108,128,17,31,0,14,15,205,95,146,35,205,95,146,25,205,95,146,35,205,95,146,58,104,128,79,25,205,95,146,35,205,95,146,24,32,58,32,128,190,32,11,121,230,15,40,6,58,32,128,246,7,119,58,77,128,190,202,5,141,58,86,128,190,202,5,141,201,58,104,128,221,38,131,221,111,58,106,128,230,1,15,95,58,105,128,230,3,15,15,15,179,95,22,130,6,16,58,108,128,230,31,79,221,126,0,221,102,1,177,111,26,182,119,35,19,26,182,119,221,35,221,35,19,16,233,201,221,126,0,205,203,146,221,35,28,122,214,8,87,13,32,240,201,38,7,111,203,253,41,41,41,6,8,126,18,35,20,16,250,201,253,126,0,254,255,200,79,6,0,175,253,86,1,122,205,43,147,54,80,253,94,2,123,205,43,147,54,40,211,254,21,32,5,253,86,1,238,24,29,32,5,253,94,2,238,24,16,236,13,32,233,205,55,147,192,253,126,1,205,43,147,54,56,253,126,2,205,43,147,54,56,253,35,253,35,253,35,24,177,214,8,15,15,15,47,246,224,111,38,89,201,58,89,132,183,40,5,219,31,203,103,192,1,254,191,237,120,230,1,254,1,201,9,68,69,67,9,69,120,15,13,9,74,82,9,78,90,44,78,79,70,76,80,54,130,15,10,9,76,68,9,69,44,40,72,76,41,140,15,7,9,88,79,82,9,50,52,150,15,16,78,79,70,76,80,54,9,68,74,78,90,9,84,77,53,49,160,15,6,9,68,69,67,9,67,170,15,11,9,74,82,9,78,90,44,84,77,53,49,180,15,19,78,79,78,79,84,69,52,9,76,68,9,65,44,40,68,69,77,79,41,190,15,5,9,79,82,9,65,200,15,12,9,74,82,9,90,44,78,79,68,69,77,49,210,15,6,9,68,69,67,9,65,220,15,13,9,74,80,9,90,44,77,65,78,68,69,65,68,230,15,12,9,76,68,9,40,68,69,77,79,41,44,65,240,15,11,9,76,68,9,66,67,44,48,70,69,72,250,15,9,9,73,78,9,65,44,40,67,41,4,16,7,9,65,78,68,9,51,49,14,16,6,9,67,80,9,51,49,24,16,12,9,74,80,9,78,90,44,83,84,65,82,84,34,16,12,9,76,68,9,65,44,40,75,69,77,80,41,44,16,5,9,79,82,9,65,54,16,12,9,74,82,9,90,44,78,79,68,69,77,49,64,16,10,9,73,78,9,65,44,40,51,49,41,74,16,5,9,79,82,9,65,84,16,12,9,74,80,9,78,90,44,83,84,65,82,84,94,16,19,78,79,68,69,77,49,9,76,68,9,66,67,44,48,69,70,70,69,72,104,16,9,9,73,78,9,65,44,40,67,41,114,16,8,9,66,73,84,9,52,44,65,124,16,14,9,74,80,9,78,90,44,67,75,67,72,69,65,84,134,16,13,9,76,68,9,65,44,40,67,72,69,65,84,41,144,16,5,9,67,80,9,55,154,16,14,9,74,80,9,78,90,44,67,75,67,72,69,65,84,164,16,10,9,76,68,9,66,44,48,70,55,72,174,16,9,9,73,78,9,65,44,40,67,41,184,16,4,9,67,80,76,194,16,7,9,65,78,68,9,51,49,204,16,6,9,67,80,9,50,48,214,16,14,9,74,80,9,78,67,44,67,75,67,72,69,65,84,224,16,13,9,76,68,9,40,83,72,69,69,84,41,44,65,234,16,10,9,74,80,9,78,69,87,83,72,84,244,16,20,67,75,67,72,69,65,84,9,76,68,9,65,44,40,67,72,69,65,84,41,254,16,5,9,67,80,9,55,8,17,10,9,74,80,9,90,44,76,79,79,80,18,17,5,9,82,76,67,65,28,17,7,9,76,68,9,69,44,65,38,17,7,9,76,68,9,68,44,48,48,17,14,9,76,68,9,73,88,44,67,72,69,65,84,68,84,58,17,10,9,65,68,68,9,73,88,44,68,69,68,17,13,9,76,68,9,66,67,44,48,70,55,70,69,72,78,17,9,9,73,78,9,65,44,40,67,41,88,17,7,9,65,78,68,9,51,49,98,17,10,9,67,80,9,40,73,88,43,48,41,108,17,13,9,74,82,9,90,44,67,75,78,88,67,72,84,118,17,6,9,67,80,9,51,49,128,17,10,9,74,80,9,90,44,76,79,79,80,138,17,10,9,67,80,9,40,73,88,45,50,41,148,17,10,9,74,80,9,90,44,76,79,79,80,158,17,6,9,88,79,82,9,65,168,17,13,9,76,68,9,40,67,72,69,65,84,41,44,65,178,17,8,9,74,80,9,76,79,79,80,188,17,17,67,75,78,88,67,72,84,9,76,68,9,66,44,48,69,70,72,198,17,9,9,73,78,9,65,44,40,67,41,208,17,7,9,65,78,68,9,51,49,218,17,10,9,67,80,9,40,73,88,43,49,41,228,17,12,9,74,82,9,90,44,73,78,67,67,72,84,238,17,6,9,67,80,9,51,49,248,17,10,9,74,80,9,90,44,76,79,79,80,2,18,10,9,67,80,9,40,73,88,45,49,41,12,18,10,9,74,80,9,90,44,76,79,79,80,22,18,6,9,88,79,82,9,65,32,18,13,9,76,68,9,40,67,72,69,65,84,41,44,65,42,18,8,9,74,80,9,76,79,79,80,52,18,19,73,78,67,67,72,84,9,76,68,9,65,44,40,67,72,69,65,84,41,62,18,6,9,73,78,67,9,65,72,18,13,9,76,68,9,40,67,72,69,65,84,41,44,65,82,18,8,9,74,80,9,76,79,79,80,92,18,19,77,65,78,68,69,65,68,9,76,68,9,65,44,40,68,69,77,79,41,102,18,5,9,79,82,9,65,112,18,14,9,74,80,9,78,90,44,78,88,83,72,69,69,84,122,18,9,9,76,68,9,65,44,52,55,72,132,18,19,76,80,68,69,65,68,49,9,76,68,9,72,76,44,53,56,48,48,72,142,18,12,9,76,68,9,68,69,44,53,56,48,49,72,152,18,11,9,76,68,9,66,67,44,49,70,70,72,162,18,10,9,76,68,9,40,72,76,41,44,65,172,18,5,9,76,68,73,82,182,18,7,9,76,68,9,69,44,65,192,18,4,9,67,80,76,202,18,6,9,65,78,68,9,55,212,18,5,9,82,76,67,65,222,18,5,9,82,76,67,65,232,18,5,9,82,76,67,65,242,18,5,9,79,82,9,55,252,18,7,9,76,68,9,68,44,65,6,19,7,9,76,68,9,67,44,69,16,19,6,9,82,82,67,9,67,26,19,6,9,82,82,67,9,67,36,19,6,9,82,82,67,9,67,46,19,6,9,79,82,9,49,54,56,19,6,9,88,79,82,9,65,66,19,16,84,77,50,49,9,79,85,84,9,40,50,53,52,41,44,65,76,19,7,9,88,79,82,9,50,52,86,19,7,9,76,68,9,66,44,68,96,19,14,84,77,50,50,9,68,74,78,90,9,84,77,50,50,106,19,6,9,68,69,67,9,67,116,19,11,9,74,82,9,78,90,44,84,77,50,49,126,19,7,9,76,68,9,65,44,69,136,19,6,9,68,69,67,9,65,146,19,7,9,67,80,9,51,70,72,156,19,14,9,74,82,9,78,90,44,76,80,68,69,65,68,49,166,19,12,9,76,68,9,72,76,44,78,79,77,69,78,176,19,10,9,76,68,9,65,44,40,72,76,41,186,19,5,9,79,82,9,65,196,19,12,9,74,80,9,90,44,69,78,68,71,65,77,206,19,9,9,68,69,67,9,40,72,76,41,216,19,10,9,74,80,9,78,69,87,83,72,84,226,19,20,69,78,68,71,65,77,9,76,68,9,72,76,44,72,71,72,83,67,79,82,236,19,14,9,76,68,9,68,69,44,83,67,79,82,66,85,70,246,19,7,9,76,68,9,66,44,54,0,20,15,76,80,72,71,72,9,76,68,9,65,44,40,68,69,41,10,20,8,9,67,80,9,40,72,76,41,20,20,10,9,74,80,9,67,44,70,69,69,84,30,20,13,9,74,80,9,78,90,44,78,69,87,72,71,72,40,20,7,9,73,78,67,9,72,76,50,20,7,9,73,78,67,9,68,69,60,20,11,9,68,74,78,90,9,76,80,72,71,72,70,20,20,78,69,87,72,71,72,9,76,68,9,72,76,44,83,67,79,82,66,85,70,80,20,14,9,76,68,9,68,69,44,72,71,72,83,67,79,82,90,20,8,9,76,68,9,66,67,44,54,100,20,5,9,76,68,73,82,110,20,16,70,69,69,84,9,76,68,9,72,76,44,52,48,48,48,72,120,20,12,9,76,68,9,68,69,44,52,48,48,49,72,130,20,12,9,76,68,9,66,67,44,48,70,70,70,72,140,20,10,9,76,68,9,40,72,76,41,44,48,150,20,5,9,76,68,73,82,160,20,6,9,88,79,82,9,65,170,20,14,9,76,68,9,40,69,85,71,72,71,84,41,44,65,180,20,16,9,76,68,9,68,69,44,77,65,78,68,65,84,43,54,52,190,20,12,9,76,68,9,72,76,44,52,56,56,70,72,200,20,7,9,76,68,9,67,44,48,210,20,12,9,67,65,76,76,9,68,82,87,70,73,88,220,20,13,9,76,68,9,68,69,44,48,66,54,69,48,72,230,20,12,9,76,68,9,72,76,44,52,56,67,70,72,240,20,7,9,76,68,9,67,44,48,250,20,12,9,67,65,76,76,9,68,82,87,70,73,88,4,21,20,76,79,79,80,70,84,9,76,68,9,65,44,40,69,85,71,72,71,84,41,14,21,7,9,76,68,9,67,44,65,24,21,9,9,76,68,9,66,44,56,51,72,34,21,10,9,76,68,9,65,44,40,66,67,41,44,21,7,9,79,82,9,48,70,72,54,21,7,9,76,68,9,76,44,65,64,21,7,9,73,78,67,9,66,67,74,21,10,9,76,68,9,65,44,40,66,67,41,84,21,8,9,83,85,66,9,50,48,72,94,21,7,9,76,68,9,72,44,65,104,21,13,9,76,68,9,68,69,44,48,66,65,69,48,72,114,21,7,9,76,68,9,67,44,48,124,21,12,9,67,65,76,76,9,68,82,87,70,73,88,134,21,14,9,76,68,9,65,44,40,69,85,71,72,71,84,41,144,21,4,9,67,80,76,154,21,7,9,76,68,9,69,44,65,164,21,6,9,88,79,82,9,65,174,21,10,9,76,68,9,66,67,44,52,48,72,184,21,17,84,77,49,49,49,9,79,85,84,9,40,50,53,52,41,44,65,194,21,7,9,88,79,82,9,50,52,204,21,7,9,76,68,9,66,44,69,214,21,16,84,77,49,49,50,9,68,74,78,90,9,84,77,49,49,50,224,21,6,9,68,69,67,9,67,234,21,12,9,74,82,9,78,90,44,84,77,49,49,49,244,21,12,9,76,68,9,72,76,44,53,56,48,48,72,254,21,12,9,76,68,9,68,69,44,53,56,48,49,72,8,22,11,9,76,68,9,66,67,44,49,70,70,72,18,22,14,9,76,68,9,65,44,40,69,85,71,72,71,84,41,28,22,8,9,65,78,68,9,48,67,72,38,22,5,9,82,76,67,65,48,22,7,9,79,82,9,52,55,72,58,22,10,9,76,68,9,40,72,76,41,44,65,68,22,5,9,76,68,73,82,78,22,14,9,76,68,9,65,44,40,69,85,71,72,71,84,41,88,22,8,9,65,68,68,9,65,44,52,98,22,14,9,76,68,9,40,69,85,71,72,71,84,41,44,65,108,22,8,9,67,80,9,48,67,52,72,118,22,13,9,74,82,9,78,90,44,76,79,79,80,70,84,128,22,12,9,76,68,9,73,88,44,77,69,83,83,71,138,22,7,9,76,68,9,67,44,52,148,22,12,9,76,68,9,68,69,44,52,48,67,65,72,158,22,11,9,67,65,76,76,9,80,77,69,83,83,168,22,12,9,76,68,9,73,88,44,77,69,83,83,79,178,22,7,9,76,68,9,67,44,52,188,22,12,9,76,68,9,68,69,44,52,48,68,50,72,198,22,11,9,67,65,76,76,9,80,77,69,83,83,208,22,8,9,76,68,9,66,67,44,48,218,22,7,9,76,68,9,68,44,54,228,22,14,84,77,57,49,9,68,74,78,90,9,84,77,57,49,238,22,7,9,76,68,9,65,44,67,248,0,132,9,65,46,32,32,46,32,32,46,32,32,46,32,32,46,32,32,46,32,32,46,32,32,46,32,32,46,32,32,46,32,32,46,32,77,65,78,73,67,32,77,73,78,69,82,32,46,32,46,32,127,32,66,85,71,45,66,89,84,69,32,108,116,100,46,32,49,57,56,51,32,46,32,46,32,66,121,32,77,97,116,116,104,101,119,32,83,109,105,116,104,32,46,32,46,32,46,32,81,32,116,111,32,80,32,61,32,76,101,102,116,32,38,32,82,105,103,104,116,32,46,32,46,32,66,111,116,116,111,109,32,114,111,119,32,61,32,74,117,109,112,32,46,32,46,32,65,32,116,111,32,71,32,61,32,80,97,117,115,101,32,46,32,46,32,72,32,116,111,32,76,32,61,32,84,117,110,101,32,79,110,47,79,102,102,32,46,32,46,32,46,32,71,117,105,100,101,32,77,105,110,101,114,32,87,105,108,108,121,32,116,104,114,111,117,103,104,32,50,48,32,108,101,116,104,97,108,32,99,97,118,101,114,110,115,32,46,32,32,46,32,32,46,32,32,46,32,32,46,32,32,46,32,32,46,32,32,46,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,16,16,16,16,16,16,16,16,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,22,22,22,22,22,22,22,22,23,23,23,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,23,23,23,23,23,23,16,16,16,16,16,16,22,22,22,22,22,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,56,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,87,87,87,87,87,87,87,87,87,87,103,103,103,103,103,103,103,103,103,103,103,103,103,103,103,103,103,103,103,103,103,103,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5,0,0,0,0,0,224,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,129,129,128,0,0,0,0,0,0,59,0,8,99,0,0,224,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,255,0,0,0,0,7,255,224,3,0,0,84,0,255,0,0,7,224,0,0,15,223,220,0,0,0,0,0,0,0,0,255,255,0,34,34,34,8,224,16,0,255,159,148,243,0,63,192,31,248,3,252,0,0,0,0,0,36,66,66,36,68,0,0,0,0,119,119,119,0,255,0,0,0,0,138,0,7,255,252,7,224,63,255,224,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,74,0,0,0,1,255,255,128,0,0,224,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,1,185,128,48,255,255,7,192,255,255,15,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,36,0,18,64,18,64,18,64,1,34,64,17,65,2,16,36,16,33,0,0,16,0,0,0,0,0,0,0,0,0,33,7,0,0,0,0,0,248,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,66,66,192,0,0,0,0,0,0,22,0,0,0,0,0,200,0,0,0,0,0,1,240,0,0,0,0,0,0,0,0,0,255,255,0,0,0,0,4,0,32,5,0,0,85,0,255,0,0,127,254,0,0,15,239,120,0,0,0,0,0,0,0,0,129,129,0,119,119,119,9,16,16,0,127,15,85,244,0,127,224,31,248,7,254,0,0,0,0,0,36,66,68,34,66,0,0,0,0,119,119,119,49,255,140,0,0,0,82,0,1,255,254,7,224,127,255,128,0,0,15,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,82,0,112,0,3,255,255,192,0,14,240,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,0,3,16,0,48,127,255,1,240,255,252,1,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,36,48,33,81,48,36,49,32,32,66,16,52,33,3,18,2,19,64,0,0,66,0,0,0,0,0,0,0,0,0,49,3,0,0,0,0,0,208,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,36,36,224,0,0,0,0,0,0,29,0,0,0,0,0,180,0,0,0,0,0,7,248,0,0,0,0,0,0,0,0,0,129,129,0,0,0,0,4,24,32,5,0,0,148,0,208,0,0,127,254,0,0,31,255,151,128,0,101,118,86,134,86,0,129,129,0,119,119,119,9,80,16,0,62,7,85,192,0,255,224,31,248,7,255,0,0,0,0,0,34,66,68,36,66,0,0,0,0,119,119,119,50,255,76,0,0,0,81,0,0,127,254,0,0,127,254,0,0,0,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,82,48,127,0,3,255,255,192,0,254,248,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,15,0,0,0,0,0,63,255,7,224,255,240,0,63,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,19,21,2,67,96,33,52,80,49,33,80,55,97,80,40,18,3,70,0,0,36,0,0,0,0,0,0,0,0,0,39,1,0,0,0,0,0,224,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,15,24,24,240,0,0,0,0,0,0,31,0,0,0,0,0,246,0,0,0,0,0,15,252,0,0,0,0,0,0,0,0,0,129,129,0,0,0,0,4,0,32,23,0,0,162,0,248,0,0,127,254,0,0,31,255,239,92,112,133,151,84,104,103,0,129,129,0,255,255,255,63,255,252,0,20,2,84,192,1,255,240,31,248,15,255,128,0,0,0,0,66,68,34,36,34,0,0,0,0,119,119,119,52,255,44,0,0,0,149,0,0,31,255,0,0,255,248,0,0,15,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,15,81,248,127,240,7,255,255,224,15,254,248,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,15,0,0,0,0,0,30,127,3,240,255,128,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,33,48,84,48,103,40,145,32,52,81,144,36,49,84,97,32,52,81,144,0,0,131,0,0,0,0,0,0,0,0,0,115,6,0,0,0,0,0,228,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,31,24,24,248,0,0,0,0,0,0,5,0,7,129,192,48,200,0,0,0,0,0,30,59,176,0,0,0,0,0,0,0,0,129,129,0,0,0,0,4,0,32,29,0,0,170,0,192,0,0,63,252,0,0,14,127,238,222,248,102,102,102,102,102,0,129,129,0,255,255,255,127,255,254,0,0,0,146,128,1,255,240,15,240,15,255,128,0,0,0,0,66,36,66,66,68,0,0,0,0,119,119,119,63,255,252,0,0,0,165,0,0,7,255,3,192,255,224,0,0,63,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,127,137,252,127,255,7,255,255,224,255,254,252,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,63,0,0,0,0,0,0,31,1,128,254,0,0,0,193,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,116,17,87,145,81,33,2,70,25,18,2,73,18,6,116,33,52,97,33,0,0,33,0,0,0,0,0,0,0,0,0,67,11,0,0,0,0,0,208,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,63,36,36,252,0,0,0,0,0,0,3,0,2,195,160,0,208,0,0,0,0,0,29,215,216,0,0,0,0,0,0,0,0,129,129,0,0,0,0,4,0,32,31,0,0,170,0,128,1,128,63,252,1,128,15,191,238,222,248,102,102,102,102,102,0,129,129,0,119,119,119,255,255,255,0,0,0,138,0,3,255,248,15,240,31,255,192,0,0,0,0,36,66,36,36,36,0,0,0,0,119,119,119,48,255,12,0,0,0,169,0,0,1,254,31,248,127,128,0,0,255,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,255,170,252,255,255,199,255,255,227,255,255,254,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,0,0,0,0,0,0,15,15,192,240,0,0,0,62,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,248,16,47,70,33,113,21,70,49,38,21,66,19,21,3,36,52,81,81,0,0,81,0,0,0,0,0,0,0,0,0,36,5,0,0,0,0,0,180,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,127,66,66,254,0,0,0,0,0,0,6,0,1,83,192,0,184,0,0,0,0,0,11,239,232,0,0,0,0,0,0,0,0,129,129,0,0,0,0,0,0,32,10,0,0,170,0,0,7,128,63,252,1,224,7,223,207,111,120,102,102,102,102,102,0,255,255,0,119,119,119,255,255,255,0,0,0,170,0,3,255,248,15,240,31,255,192,0,0,0,0,34,66,68,34,66,0,0,0,0,119,119,119,48,60,12,0,0,0,170,0,0,0,124,127,254,62,0,0,15,255,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,15,255,170,254,255,255,207,255,255,243,255,255,254,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,0,0,0,0,0,0,7,3,240,224,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,32,49,32,51,32,49,32,2,16,66,16,18,64,16,66,64,16,66,0,0,130,0,0,0,0,0,0,0,0,0,64,42,0,0,0,0,0,248,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,129,129,255,0,0,0,0,0,0,3,0,0,163,0,0,100,0,0,0,0,0,7,223,236,0,0,0,0,0,0,0,0,255,255,0,0,0,0,4,0,32,7,0,0,162,0,0,31,192,63,252,3,248,3,143,135,191,240,102,102,102,102,102,0,255,255,0,119,119,119,255,255,255,0,0,0,170,0,7,255,252,15,240,63,255,224,0,0,0,126,166,246,166,246,166,0,0,0,0,119,119,119,48,0,12,0,0,0,138,0,0,0,24,255,255,24,0,0,255,255,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,63,255,74,255,255,255,207,255,255,243,255,255,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,0,0,0,0,0,0,1,1,192,128,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,252,189,254,188,253,190,203,223,235,207,205,239,207,191,254,205,188,206,189,0,0,219,0,0,0,0,0,0,0,0,0,189,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,130,12,63,134,30,51,128,0,0,34,49,140,60,96,12,96,96,0,0,139,162,251,192,139,160,136,128,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,252,252,254,124,124,0,254,198,254,254,252,0,254,124,0,124,254,16,252,254,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,199,199,193,7,199,193,7,199,199,193,7,199,193,7,199,193,7,199,199,193,7,199,193,7,199,199,193,7,199,193,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,65,0,12,96,198,14,49,129,0,0,32,49,140,28,96,76,48,112,0,0,217,50,130,32,137,32,133,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,254,254,254,254,254,0,254,230,254,254,254,0,254,254,0,254,254,56,254,254,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,199,199,193,7,199,193,7,199,199,193,7,199,193,7,199,193,7,199,199,193,7,199,193,7,199,199,193,7,199,193,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,0,3,255,30,4,14,15,120,58,0,7,248,59,220,30,255,159,240,0,0,0,1,255,136,243,206,137,255,128,0,0,0,0,130,0,12,64,198,6,48,198,0,0,32,49,140,12,97,140,24,16,0,0,169,42,227,192,169,32,130,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,198,198,192,194,194,0,192,246,48,192,198,0,48,198,0,194,48,108,198,48,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,199,199,193,7,199,193,7,199,199,193,7,199,193,7,199,193,7,199,199,193,7,199,193,7,199,199,193,7,199,193,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,0,6,7,60,14,7,6,48,198,0,8,56,113,142,12,97,140,56,0,0,0,2,4,20,138,36,202,0,0,0,0,0,0,140,0,30,225,239,2,120,56,0,0,112,123,222,4,255,158,14,32,0,0,137,38,130,128,169,32,130,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,254,254,240,248,248,0,240,246,48,240,254,0,48,198,0,248,48,198,254,48,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,199,199,193,7,199,193,7,199,199,193,7,199,193,7,199,193,7,199,199,193,7,199,193,7,199,199,193,7,199,193,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,9,139,108,14,7,134,49,131,0,16,44,113,143,12,96,76,24,0,0,0,1,196,34,243,196,170,96,0,0,0,0,0,112,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,192,0,0,139,162,250,96,83,190,250,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,252,252,240,62,62,0,240,222,48,240,252,0,48,198,0,62,48,198,252,48,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,199,199,193,7,199,193,7,199,199,193,7,199,193,7,199,193,7,199,199,193,7,199,193,7,199,199,193,7,199,193,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,9,147,204,27,6,198,51,128,0,16,44,177,141,140,98,12,24,0,0,0,0,36,62,162,132,154,32,0,0,0,0,255,7,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,240,31,240,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,192,216,192,134,134,0,192,222,48,192,216,0,48,198,0,134,48,254,216,48,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,199,199,193,7,199,193,7,199,199,193,7,199,193,7,199,193,7,199,199,193,7,199,193,7,199,199,193,7,199,193,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,35,140,19,6,102,51,0,0,19,38,177,140,204,126,15,240,0,0,0,255,196,34,154,110,137,192,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,192,204,254,254,254,0,254,206,48,254,204,0,48,254,0,254,48,254,204,48,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,199,199,193,7,199,193,7,199,199,193,7,199,193,7,199,193,7,199,199,193,7,199,193,7,199,199,193,7,199,193,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,67,12,49,134,54,51,0,0,12,39,49,140,108,98,12,192,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,192,198,254,124,124,0,254,198,48,254,198,0,48,124,0,124,48,198,198,48,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,199,199,193,7,199,193,7,199,199,193,7,199,193,7,199,193,7,199,199,193,7,199,193,7,199,199,193,7,199,193,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,22,0,0,0,0,0,0,0,0,0,0,5,0,0,0,0,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,68,0,0,0,68,0,0,0,22,22,66,66,66,66,66,66,66,66,66,66,66,66,66,2,2,2,2,66,2,2,2,2,66,66,66,66,66,66,66,66,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,66,66,66,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,22,0,68,0,0,0,0,0,0,0,0,0,22,22,66,66,66,66,0,0,0,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,66,66,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,68,0,0,0,0,0,0,0,22,22,22,2,2,2,2,2,66,66,66,22,22,0,0,0,0,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,22,32,32,32,32,32,32,32,32,32,67,101,110,116,114,97,108,32,67,97,118,101,114,110,32,32,32,32,32,32,32,32,32,0,0,0,0,0,0,0,0,0,66,255,255,219,110,197,64,0,0,2,255,219,165,36,82,32,8,0,22,34,255,136,255,34,255,136,255,4,240,102,240,102,0,153,255,0,68,68,40,148,81,53,214,88,16,5,255,254,126,124,76,76,8,8,0,0,0,0,0,0,0,0,0,208,0,0,0,162,93,0,0,40,120,20,2,0,3,9,92,96,255,4,29,92,96,255,5,48,92,96,255,6,152,92,96,255,3,222,92,96,255,255,14,255,255,146,73,182,219,255,255,146,73,182,219,255,255,146,73,182,219,255,255,146,73,182,219,255,255,146,73,182,219,255,255,189,93,189,104,48,72,136,144,104,4,10,4,63,252,70,232,92,96,0,232,239,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,0,0,255,0,0,2,160,5,67,31,228,115,255,242,248,31,63,255,228,63,195,0,0,1,0,57,252,111,2,81,1,127,254,57,252,1,0,31,32,57,224,25,224,15,32,159,0,95,128,255,192,94,0,159,192,31,128,14,0,31,0,187,160,113,192,32,128,17,0,7,196,14,124,6,124,35,196,23,192,23,224,63,240,23,240,23,240,39,224,3,128,3,128,6,192,6,192,28,112,6,192,1,242,3,158,1,158,0,242,9,240,5,248,15,252,5,224,9,252,1,248,0,224,0,224,0,224,0,224,0,224,1,240,0,125,0,231,0,103,0,61,0,124,0,127,3,252,0,120,0,124,0,127,0,56,0,56,0,108,0,108,1,199,0,108,190,0,231,0,230,0,188,0,62,0,254,0,63,192,30,0,62,0,254,0,28,0,28,0,54,0,54,0,227,128,54,0,79,128,121,192,121,128,79,0,15,144,31,160,63,240,7,160,63,144,31,128,7,0,7,0,7,0,7,0,7,0,15,128,35,224,62,112,62,96,35,196,3,232,7,232,15,252,15,232,15,232,7,228,1,192,1,192,3,96,3,96,14,56,3,96,4,248,7,156,7,152,4,240,0,249,1,250,3,255,0,122,3,249,1,248,0,112,0,248,5,221,3,142,1,4,0,136,22,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,22,22,22,22,22,22,22,22,22,22,22,22,22,22,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,13,22,22,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,22,22,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,11,11,11,75,8,8,8,8,8,8,22,22,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,22,22,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,8,8,8,8,8,8,8,8,22,8,8,22,22,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,75,75,75,75,22,11,11,22,8,8,22,22,75,11,11,11,11,11,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,22,8,8,22,8,8,22,22,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,22,11,11,22,8,8,22,22,8,8,8,8,8,8,8,8,75,75,75,75,75,75,75,8,8,8,8,8,8,8,8,8,22,11,11,22,8,8,22,22,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,11,11,11,11,8,8,22,11,11,22,8,8,22,22,8,8,14,14,14,14,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,22,11,11,22,8,8,22,22,8,8,8,8,8,8,8,8,8,8,8,8,8,75,75,75,75,8,8,8,8,8,8,8,22,11,11,22,8,8,22,22,8,8,8,8,8,8,8,11,11,11,11,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,22,22,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,22,22,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,22,32,32,32,32,32,32,32,32,32,32,84,104,101,32,67,111,108,100,32,82,111,111,109,32,32,32,32,32,32,32,32,32,8,0,0,0,0,0,0,0,0,75,255,255,219,110,197,64,0,0,11,255,219,165,36,82,32,8,0,22,34,255,136,255,34,255,136,255,14,240,102,240,102,0,153,255,0,12,68,40,148,81,53,214,88,16,13,255,254,94,108,76,76,8,8,0,0,0,0,0,0,0,0,0,208,0,0,0,162,93,0,1,99,120,4,2,0,11,39,92,96,255,12,56,92,96,255,13,250,92,96,255,14,35,93,104,255,11,147,93,104,255,255,83,255,255,146,73,146,73,146,73,146,73,146,73,146,73,146,73,146,73,146,73,146,73,146,73,146,73,146,73,146,73,255,255,189,93,189,104,80,168,84,168,84,44,2,1,63,252,14,114,92,96,7,97,114,13,189,93,104,7,172,189,255,0,0,0,0,0,0,0,0,0,0,0,0,0,255,0,0,255,0,0,255,255,114,78,138,81,170,85,74,82,18,72,34,68,42,84,42,84,42,84,42,84,42,84,42,84,42,84,42,84,42,84,12,0,30,0,27,0,30,192,57,0,50,0,58,0,61,0,109,0,105,0,105,0,97,0,113,0,190,0,8,0,30,0,3,0,7,128,6,192,7,176,14,64,12,128,15,128,13,192,27,64,27,64,22,64,24,64,28,64,47,128,5,64,15,128,0,192,1,224,1,176,1,236,3,144,3,32,3,160,3,208,6,208,6,144,6,144,6,16,7,16,11,232,2,80,7,224,0,48,0,120,0,108,0,123,0,228,0,200,0,232,0,244,1,180,1,148,1,148,1,132,1,196,2,248,0,84,0,248,12,0,30,0,54,0,222,0,39,0,19,0,23,0,47,0,45,128,41,128,41,128,33,128,35,128,31,64,42,0,31,0,3,0,7,128,13,128,55,128,9,192,4,192,5,192,11,192,11,96,9,96,9,96,8,96,8,224,23,208,10,64,7,224,0,192,1,224,3,96,13,224,2,112,1,48,1,240,3,176,2,216,2,216,2,104,2,24,2,56,1,244,2,160,1,240,0,48,0,120,0,216,3,120,0,156,0,76,0,92,0,188,0,182,0,150,0,150,0,134,0,142,0,125,0,16,0,120,13,0,0,0,0,0,0,0,0,0,67,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,67,0,0,0,13,13,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,67,0,0,0,0,0,0,0,0,0,0,0,0,13,13,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,13,13,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,13,13,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,13,13,69,69,69,69,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,13,13,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,13,13,69,69,69,69,69,69,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,69,69,69,69,13,13,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,13,13,3,0,0,0,0,2,2,2,2,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,13,13,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,69,69,69,69,69,69,13,13,67,0,0,0,0,0,0,0,0,0,0,0,0,69,69,69,69,69,0,0,0,0,0,0,0,0,0,0,0,0,13,13,0,0,0,0,69,69,69,69,69,69,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,13,13,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,69,69,69,69,69,69,69,69,69,69,13,13,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,13,13,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,13,32,32,32,32,32,32,32,32,32,32,84,104,101,32,77,101,110,97,103,101,114,105,101,32,32,32,32,32,32,32,32,32,0,0,0,0,0,0,0,0,0,69,255,255,102,153,102,153,255,0,5,255,255,102,153,66,24,234,0,13,129,195,165,153,153,165,195,129,2,240,170,240,102,102,0,0,0,6,68,40,148,81,53,214,88,16,67,16,214,56,214,56,68,198,40,3,16,16,16,16,16,16,16,16,208,0,0,0,162,93,0,0,38,120,6,2,0,3,6,92,96,255,4,15,92,96,255,5,23,92,96,255,6,222,92,96,255,3,213,92,96,255,255,14,255,255,68,68,153,153,34,34,34,34,153,153,68,68,68,68,153,153,34,34,34,34,153,153,68,68,68,68,153,153,255,255,125,93,125,104,48,72,136,144,104,4,10,4,63,128,68,179,93,104,7,161,179,67,112,92,96,7,97,112,66,114,92,96,0,114,125,255,0,0,0,0,0,0,255,0,0,255,0,0,42,192,53,64,63,192,9,0,9,0,31,128,16,128,16,128,17,128,34,64,32,184,89,36,68,66,68,2,68,2,255,255,3,0,6,128,7,192,3,0,1,128,0,192,190,192,227,128,65,0,171,0,127,0,62,0,8,0,8,0,8,0,20,0,0,192,1,160,1,240,0,192,0,96,0,48,47,176,56,224,24,192,48,192,21,192,10,128,21,0,2,0,5,0,0,0,0,48,0,104,0,124,0,48,0,24,0,12,11,236,14,56,4,16,10,176,7,240,3,224,0,128,1,64,0,0,0,0,0,12,0,26,0,31,0,172,1,86,0,171,3,91,3,134,1,12,3,252,1,252,0,248,0,32,0,32,0,80,0,0,48,0,88,0,248,0,53,0,106,128,213,0,218,192,97,192,48,128,63,192,63,128,31,0,4,0,4,0,10,0,0,0,12,0,22,0,62,0,12,0,24,0,48,0,55,208,28,112,8,32,13,80,15,224,7,192,1,0,2,128,0,0,0,0,3,0,5,128,15,128,3,0,6,0,12,0,13,244,7,28,3,24,3,12,3,168,1,80,0,168,0,64,0,160,0,0,0,192,1,96,3,224,0,192,1,128,3,0,3,125,1,199,0,130,0,213,0,254,0,124,0,16,0,16,0,16,0,40,41,0,0,0,0,0,0,5,0,0,0,0,0,0,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,41,41,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,41,41,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,70,70,70,70,70,70,0,0,0,0,0,0,41,41,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,70,70,70,70,41,41,70,0,0,0,0,0,70,0,0,0,0,0,0,0,0,0,70,0,0,0,0,0,0,0,0,0,0,0,0,0,41,41,0,0,0,0,0,0,0,0,0,0,0,70,70,0,0,0,0,0,0,0,70,70,70,0,0,0,0,0,0,0,41,41,6,6,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,41,41,0,0,0,0,0,0,70,70,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,70,70,70,0,0,41,41,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,70,70,70,0,0,0,0,0,0,0,0,0,0,41,41,3,3,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,70,41,41,0,0,0,0,0,0,0,0,0,0,0,70,70,70,0,0,0,0,0,0,0,70,70,70,0,0,0,0,0,0,41,41,0,0,0,0,0,70,70,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5,0,0,0,0,70,70,70,41,41,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,70,70,0,0,0,0,0,0,0,0,0,0,0,41,41,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,41,41,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,41,32,32,32,65,98,97,110,100,111,110,101,100,32,85,114,97,110,105,117,109,32,87,111,114,107,105,110,103,115,32,32,32,0,0,0,0,0,0,0,0,0,70,255,255,219,110,197,64,0,0,6,255,219,165,36,82,32,8,0,41,34,255,136,255,34,255,136,255,3,240,102,240,102,0,153,255,0,4,68,40,148,81,53,214,88,16,5,16,16,16,84,56,214,56,84,0,0,0,0,0,0,0,0,0,208,0,1,0,189,93,0,1,65,120,3,2,0,3,1,92,96,255,4,44,92,96,255,5,57,92,96,255,6,208,92,96,255,3,222,92,96,255,255,14,34,34,17,17,136,136,68,68,34,34,17,17,136,136,68,68,34,34,17,17,136,136,68,68,34,34,17,17,136,136,68,68,61,92,61,96,48,72,136,144,104,4,10,4,63,128,66,161,93,104,0,161,170,68,167,93,104,0,166,175,255,0,0,0,0,0,0,0,0,0,0,0,0,0,255,0,0,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,0,11,128,19,192,19,192,19,192,11,128,7,0,1,0,7,0,5,0,7,0,7,128,79,128,95,192,254,192,60,64,1,192,2,224,5,208,5,208,5,208,2,224,1,192,0,64,1,192,1,64,1,192,1,224,35,224,47,240,127,176,31,16,0,112,0,232,1,228,1,228,1,228,0,232,0,112,0,16,0,112,0,80,0,112,0,248,33,248,39,252,127,236,15,196,0,28,0,54,0,99,0,99,0,99,0,54,0,28,0,4,0,28,0,20,0,28,0,30,4,62,4,255,15,251,3,241,56,0,108,0,198,0,198,0,198,0,108,0,56,0,32,0,56,0,40,0,56,0,120,0,124,32,255,32,223,240,143,192,14,0,23,0,39,128,39,128,39,128,23,0,14,0,8,0,14,0,10,0,14,0,31,0,31,132,63,228,55,254,35,240,3,128,7,64,11,160,11,160,11,160,7,64,3,128,2,0,3,128,2,128,3,128,7,128,7,196,15,244,13,254,8,248,0,224,1,208,3,200,3,200,3,200,1,208,0,224,0,128,0,224,0,160,0,224,1,224,1,242,3,250,3,127,2,60,46,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,19,16,16,16,16,16,16,16,16,16,16,46,46,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,46,46,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,46,46,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,46,46,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,22,16,16,16,16,16,16,46,46,21,21,21,21,21,21,21,21,21,21,21,21,21,16,16,16,16,20,20,20,20,21,21,21,21,21,21,16,16,16,46,46,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,21,21,46,46,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,22,16,16,16,16,16,16,16,16,16,46,46,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,86,86,86,86,86,86,86,86,86,86,16,16,16,46,46,16,16,16,21,21,21,21,21,21,21,21,21,21,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,46,46,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,46,46,20,20,21,21,21,21,21,21,21,21,21,21,21,16,16,16,16,21,21,21,21,21,21,21,16,16,16,16,16,21,46,46,16,16,16,16,16,16,16,46,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,46,46,21,21,16,16,16,16,16,46,16,16,16,16,16,46,16,16,46,16,16,16,16,16,16,16,16,16,16,16,16,16,46,46,16,16,16,16,22,16,16,46,16,16,16,16,16,46,16,16,46,46,46,46,46,46,46,22,22,16,16,16,16,16,46,46,21,21,21,21,21,21,21,46,46,46,46,46,46,46,46,46,46,46,46,46,46,46,46,21,21,21,21,21,21,21,46,32,32,32,32,32,32,32,32,32,69,117,103,101,110,101,39,115,32,76,97,105,114,32,32,32,32,32,32,32,32,32,32,16,0,0,0,0,0,0,0,0,21,255,255,219,110,197,64,0,0,20,255,219,165,36,82,32,8,0,46,34,255,136,255,34,255,136,255,86,252,102,252,102,0,0,0,0,22,68,40,148,81,53,214,88,16,19,126,60,28,24,24,8,8,8,0,0,0,0,0,0,0,0,0,48,0,0,0,97,92,0,0,18,120,10,1,0,19,62,92,96,255,20,202,92,96,255,21,253,92,96,255,22,135,93,104,255,19,137,93,104,255,255,87,255,255,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,170,255,255,175,93,175,104,31,35,71,255,143,142,140,248,63,128,22,108,92,96,7,97,108,16,228,92,96,0,228,236,255,0,0,0,0,0,0,0,0,0,0,0,0,0,255,0,0,0,0,0,3,192,15,240,31,248,31,248,49,140,14,112,111,246,174,117,177,141,159,249,155,217,140,49,71,226,2,64,2,64,14,112,192,0,192,0,192,0,192,0,192,0,192,0,192,0,223,192,223,192,255,192,31,192,15,128,119,128,255,0,223,0,223,0,48,0,48,0,48,0,48,0,48,32,48,192,51,0,52,0,55,240,63,240,7,240,3,224,29,224,63,192,55,192,55,192,12,0,12,0,12,32,12,64,12,64,12,128,12,128,13,0,13,252,15,252,1,252,0,248,7,120,15,240,13,240,13,240,3,0,3,0,3,0,3,0,3,2,3,12,3,48,3,64,3,127,3,255,0,127,0,62,1,222,3,252,3,124,3,124,0,192,0,192,0,192,0,192,64,192,48,192,12,192,2,192,254,192,255,192,254,0,124,0,123,128,63,192,62,192,62,192,0,48,0,48,4,48,2,48,2,48,1,48,1,48,0,176,63,176,63,240,63,128,31,0,30,224,15,240,15,176,15,176,0,12,0,12,0,12,0,12,4,12,3,12,0,204,0,44,15,236,15,252,15,224,7,192,7,184,3,252,3,236,3,236,0,3,0,3,0,3,0,3,0,3,0,3,0,3,3,251,3,251,3,255,3,248,1,240,1,238,0,255,0,251,0,251,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,68,68,68,0,0,0,0,68,68,0,0,0,0,68,68,68,68,68,0,0,0,0,0,22,22,0,0,68,68,0,0,0,0,0,0,0,0,0,0,0,22,0,0,0,0,0,0,0,0,0,0,0,68,68,68,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,68,68,68,68,68,0,0,0,22,22,68,68,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,68,68,68,68,68,68,68,68,68,22,68,68,68,68,68,68,68,68,68,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,6,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,67,0,0,0,0,0,0,0,0,0,0,0,0,22,0,0,0,0,0,0,0,0,0,0,0,68,68,68,22,22,0,0,5,5,5,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,68,68,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,22,32,32,32,32,32,32,32,80,114,111,99,101,115,115,105,110,103,32,80,108,97,110,116,32,32,32,32,32,32,32,32,32,0,0,0,0,0,0,0,0,0,68,255,255,153,153,255,153,102,0,4,255,219,165,36,82,32,8,0,22,255,153,255,102,255,153,255,102,5,240,102,240,102,0,153,255,0,67,68,40,148,81,53,214,88,16,6,60,24,189,231,231,189,24,60,0,0,0,0,0,0,0,0,0,48,3,1,0,111,92,0,0,163,120,4,2,0,3,207,92,96,255,4,209,92,96,255,5,254,92,96,255,6,65,93,104,255,3,109,93,104,255,255,14,255,255,129,129,191,253,191,253,176,13,176,13,176,13,240,15,240,15,176,13,176,13,176,13,191,253,191,253,129,129,255,255,29,92,29,96,48,72,136,144,104,4,10,4,63,128,70,6,93,104,0,6,13,67,14,93,104,1,14,21,69,168,93,104,2,168,180,6,184,93,104,3,184,189,255,0,0,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,31,0,127,192,115,224,243,128,254,0,248,0,254,0,255,128,127,224,127,192,31,0,10,0,10,0,10,0,10,0,31,0,7,192,31,240,30,112,62,120,63,248,62,0,63,248,63,248,31,240,31,240,7,192,2,128,2,128,7,192,0,0,0,0,1,240,7,252,7,62,15,56,15,224,15,128,15,224,15,248,7,254,7,252,1,240,1,240,0,0,0,0,0,0,0,0,0,124,1,207,1,206,3,252,3,240,3,224,3,240,3,252,1,254,1,255,0,124,0,40,0,40,0,124,0,0,0,0,62,0,243,128,115,128,63,192,15,192,7,192,15,192,63,192,127,128,255,128,62,0,20,0,20,0,62,0,0,0,0,0,15,128,63,224,124,224,28,240,7,240,1,240,7,240,31,240,127,224,63,224,15,128,15,128,0,0,0,0,0,0,0,0,3,224,15,248,14,120,30,124,31,252,0,124,31,252,31,252,15,248,15,248,3,224,1,64,1,64,3,224,0,0,0,0,0,248,3,254,7,206,1,207,0,127,0,31,0,127,1,255,7,254,3,254,0,248,0,80,0,80,0,80,0,80,0,248,77,0,0,0,0,0,0,0,0,0,0,0,0,0,77,77,77,77,77,77,77,77,77,77,77,77,77,77,77,77,77,77,77,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,77,77,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,77,77,0,0,0,0,0,0,0,0,0,0,0,0,0,0,70,70,77,2,2,2,2,2,2,2,2,2,2,2,2,0,77,77,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,77,2,2,2,2,2,2,2,2,2,2,2,2,2,77,77,0,0,0,0,0,0,4,4,4,4,4,0,0,70,70,70,77,2,2,2,2,2,2,2,2,2,2,22,2,2,77,77,70,70,70,0,0,0,0,0,0,0,0,0,0,0,0,0,77,2,2,0,2,2,2,2,2,2,2,2,2,2,77,77,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,77,2,2,2,2,2,2,2,2,2,0,2,2,2,77,77,70,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,77,2,2,2,2,2,22,2,2,2,2,2,2,2,77,77,0,0,0,0,0,0,0,0,0,0,0,0,0,70,70,70,77,2,2,2,2,2,2,2,2,2,2,2,2,2,77,77,70,70,70,70,70,70,70,70,70,70,70,0,0,0,0,0,77,2,0,2,2,2,2,2,2,2,2,22,2,2,77,77,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,77,2,2,2,2,2,2,2,2,2,2,2,2,0,77,77,0,0,0,0,0,0,0,0,0,0,0,0,0,77,77,77,77,2,2,2,2,2,22,2,2,2,2,2,2,2,77,77,0,0,0,0,0,0,0,0,70,70,70,0,0,77,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,77,77,0,0,0,0,0,0,0,0,0,0,0,0,0,77,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,77,77,70,70,70,70,70,70,70,70,70,70,70,70,70,77,77,77,77,77,77,77,77,77,77,77,77,77,77,77,77,77,77,32,32,32,32,32,32,32,32,32,32,32,32,84,104,101,32,86,97,116,32,32,32,32,32,32,32,32,32,32,32,32,32,0,0,0,0,0,0,0,0,0,70,255,255,219,110,197,64,0,0,2,255,170,85,170,85,170,85,170,77,34,255,136,255,34,255,136,255,4,244,102,244,0,0,0,0,0,21,68,40,148,81,53,214,88,16,22,165,66,60,219,60,126,165,36,0,0,0,0,0,0,0,0,0,208,0,0,0,162,93,0,0,167,112,5,4,0,19,126,92,96,255,20,212,92,96,255,21,251,92,96,255,22,83,93,104,255,19,126,93,104,255,255,11,255,255,129,129,129,129,129,129,129,129,129,129,129,129,255,255,255,255,129,129,129,129,129,129,129,129,129,129,129,129,255,255,175,93,175,104,48,72,136,144,104,4,10,4,63,128,69,47,92,96,0,47,61,67,10,93,104,7,2,10,6,177,93,104,0,177,189,255,0,0,0,0,0,0,255,0,0,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,24,0,28,0,10,128,15,128,12,0,28,0,30,0,29,0,60,0,62,0,62,0,110,0,68,0,66,0,129,0,0,0,0,0,0,0,6,0,7,0,2,160,3,224,3,128,7,0,7,128,7,64,15,0,15,128,15,128,27,128,51,0,64,192,0,0,0,0,0,0,0,0,1,128,1,192,0,168,0,248,0,224,1,192,1,224,1,208,3,192,3,224,7,224,62,248,0,0,0,0,0,96,0,112,0,42,0,62,0,56,0,112,0,120,0,116,0,240,0,248,1,248,1,176,3,12,4,0,0,0,0,0,6,0,14,0,84,0,124,0,28,0,14,0,30,0,46,0,15,0,31,0,31,128,13,128,48,192,0,32,0,0,0,0,0,0,0,0,1,128,3,128,21,0,31,0,7,0,3,128,7,128,11,128,3,192,7,192,7,224,31,124,0,0,0,0,0,96,0,224,5,64,7,192,1,192,0,224,1,224,2,224,0,240,1,240,1,240,1,216,0,204,3,2,0,24,0,56,1,80,1,240,0,48,0,56,0,120,0,184,0,60,0,124,0,124,0,118,0,34,0,66,0,129,0,0,114,0,5,0,0,0,6,0,0,0,5,0,0,0,0,0,0,114,6,0,114,0,0,0,0,0,0,0,0,0,0,114,114,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,114,0,0,114,0,0,0,0,0,0,0,0,0,0,114,114,0,0,0,0,0,0,0,0,0,0,0,0,0,0,66,66,114,0,0,0,0,0,0,0,0,0,0,0,66,66,114,114,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,114,0,0,0,0,0,0,0,0,0,0,0,0,0,114,114,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,114,0,0,0,0,0,0,0,0,0,0,0,0,0,114,114,66,66,66,0,0,0,0,0,66,66,66,66,66,66,0,0,114,66,66,0,0,0,0,0,0,0,0,0,0,0,114,114,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,114,0,0,0,66,66,66,66,0,0,0,0,0,66,114,114,0,66,66,66,0,0,0,0,0,0,0,0,0,0,0,0,114,0,0,0,0,0,0,0,0,0,66,0,0,0,114,114,0,0,0,0,0,0,0,66,66,66,0,0,0,0,0,0,114,0,0,0,0,0,0,0,0,0,0,0,0,0,114,114,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,114,66,66,66,66,66,0,0,0,0,0,0,0,0,114,114,66,0,0,0,0,0,0,0,0,0,0,66,66,66,0,0,114,0,0,0,0,0,0,0,0,0,66,66,66,66,114,114,0,0,0,0,0,0,0,0,66,66,0,0,0,0,0,0,114,0,0,0,0,0,0,0,0,0,0,0,0,0,114,114,0,0,0,66,66,0,0,0,0,0,0,0,0,0,0,0,114,0,0,0,0,66,66,66,66,66,0,0,0,0,114,114,0,0,0,0,0,0,0,0,0,0,68,68,68,114,0,0,114,66,66,0,0,0,0,0,0,0,0,0,0,0,114,114,0,0,0,0,0,0,0,0,0,0,0,0,0,114,0,0,114,0,0,0,0,0,4,0,0,0,0,0,0,0,114,114,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,114,77,105,110,101,114,32,87,105,108,108,121,32,109,101,101,116,115,32,116,104,101,32,75,111,110,103,32,66,101,97,115,116,0,0,0,0,0,0,0,0,0,66,255,255,219,110,197,64,0,0,2,255,219,165,36,82,32,8,0,114,34,255,136,255,34,255,136,255,68,240,102,240,170,0,0,0,0,4,68,40,148,81,53,214,88,16,5,126,60,28,24,24,8,8,8,6,255,129,129,66,60,16,96,96,208,0,0,0,162,93,0,1,171,120,3,2,0,3,77,92,96,255,4,206,92,96,255,5,2,93,104,255,6,189,93,104,255,255,255,255,255,255,255,14,255,255,128,1,192,3,160,5,144,9,200,19,164,37,146,73,201,147,164,37,146,73,201,147,164,37,201,147,146,73,255,255,175,93,175,104,128,192,236,114,40,84,138,135,63,128,68,169,93,104,7,161,169,195,107,93,104,0,107,111,0,0,0,0,0,0,0,5,242,92,96,0,242,245,255,0,0,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,19,200,29,184,15,240,6,96,5,160,2,64,7,224,15,240,31,248,51,204,99,198,70,98,44,52,6,96,2,64,14,112,11,208,13,176,15,240,6,96,5,160,2,64,3,192,31,248,127,254,231,231,131,193,199,227,6,96,12,48,8,16,56,28,28,56,6,96,12,48,102,102,35,196,103,230,55,236,31,248,15,240,7,224,2,64,5,160,6,96,15,240,13,176,11,208,112,14,24,24,12,48,6,96,99,198,39,228,103,230,55,236,31,248,15,240,2,64,5,160,22,104,15,240,13,176,3,192,8,0,5,0,8,128,37,0,72,128,33,0,76,0,51,0,68,128,68,128,136,64,132,64,72,128,72,128,51,0,12,0,2,0,17,32,10,64,17,32,10,64,16,32,3,0,12,192,16,32,16,96,34,144,37,16,24,32,16,32,12,192,3,0,0,64,2,32,4,72,2,36,4,72,2,4,0,200,3,48,4,8,4,8,11,68,8,180,4,8,4,8,3,48,0,192,0,68,1,34,2,68,1,34,2,68,1,2,2,48,0,204,1,66,1,34,2,17,2,33,1,18,1,10,0,204,0,48,22,0,0,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,6,6,6,6,0,0,6,6,6,0,0,6,6,6,6,6,6,6,6,0,0,6,6,6,0,0,6,6,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,6,22,22,0,0,6,6,0,0,6,6,6,0,0,4,4,4,4,4,4,4,4,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,6,6,0,0,6,6,0,0,22,22,6,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,6,6,0,0,6,6,6,0,0,6,6,6,6,6,6,6,6,0,0,6,6,6,0,0,6,6,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,6,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,22,32,32,32,32,32,32,32,32,87,97,99,107,121,32,65,109,111,101,98,97,116,114,111,110,115,32,32,32,32,32,32,32,0,0,0,0,0,0,0,0,0,6,255,255,219,110,197,64,0,0,66,255,219,165,36,82,32,8,0,22,90,90,90,90,90,90,90,90,4,240,102,240,102,0,0,0,0,68,68,40,148,81,53,214,88,16,5,126,60,28,24,24,8,8,8,0,0,0,0,0,0,0,0,0,208,0,0,0,161,93,0,1,12,120,8,1,0,3,48,92,96,255,255,255,255,255,255,0,255,255,255,255,0,255,255,255,255,0,255,255,255,255,255,14,255,255,128,1,129,129,130,65,132,33,136,17,144,9,161,133,161,133,144,9,136,17,132,33,130,65,129,129,128,1,255,255,1,92,1,96,48,72,136,144,104,4,10,4,63,128,68,108,92,96,0,108,114,133,80,93,104,0,76,82,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,0,0,67,0,8,5,1,5,100,4,1,8,10,2,5,100,5,2,8,20,1,5,100,66,3,8,25,2,5,100,255,0,0,0,0,0,0,10,32,22,104,1,80,57,98,101,206,3,208,255,238,135,241,119,228,199,255,139,241,50,172,100,166,73,162,18,144,54,152,0,0,5,32,3,64,49,116,29,204,3,208,63,236,7,244,63,224,103,252,11,242,50,172,36,164,11,144,26,216,0,192,0,0,0,0,2,32,9,96,5,200,3,208,31,224,7,248,31,224,23,248,15,240,18,168,5,160,10,176,0,192,0,0,0,0,5,32,3,64,49,116,29,204,3,208,63,236,7,244,63,224,103,252,11,242,50,172,36,164,11,144,26,216,0,192,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,255,192,12,0,97,128,210,192,179,64,97,128,3,0,3,0,3,0,3,0,3,0,3,0,3,0,3,0,3,0,3,0,63,240,3,0,24,96,36,208,60,208,24,96,0,192,0,192,0,192,0,192,0,192,0,192,0,192,0,192,0,192,0,192,15,252,0,192,6,24,11,52,13,44,6,24,0,48,0,48,0,48,0,48,0,48,0,48,0,48,0,48,0,48,0,48,3,255,0,48,1,134,2,77,3,205,1,134,22,0,0,0,0,0,0,0,0,0,0,4,0,68,68,68,22,0,4,0,4,68,68,68,68,68,68,68,68,68,68,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,0,0,0,0,4,0,0,0,0,0,0,0,0,0,22,22,68,68,68,68,68,68,0,0,0,0,0,0,0,0,0,22,0,0,0,0,0,0,0,0,0,0,68,68,68,68,22,22,0,0,4,0,0,0,0,0,0,0,0,0,0,0,0,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,68,68,68,68,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,68,2,2,2,2,2,2,2,22,0,0,0,0,0,0,68,68,68,68,68,68,68,68,22,22,68,68,68,68,0,0,0,0,0,0,0,0,0,0,0,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,68,68,68,68,68,68,68,2,2,2,0,0,0,0,22,22,68,68,68,68,68,0,0,0,0,0,0,0,0,0,0,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,4,0,0,0,0,0,0,0,68,68,68,68,68,68,68,22,0,0,0,0,0,0,0,0,0,0,0,0,68,68,22,22,68,68,68,68,2,2,0,0,0,0,0,0,0,0,0,22,68,68,68,68,68,68,68,0,0,0,0,0,0,4,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,0,0,0,0,0,0,4,2,2,2,0,0,0,0,22,22,0,0,0,0,0,0,0,5,5,5,5,5,5,5,5,5,5,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,68,68,68,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,68,68,68,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,32,32,32,32,32,32,32,84,104,101,32,69,110,100,111,114,105,97,110,32,70,111,114,101,115,116,32,32,32,32,32,32,0,0,0,0,0,0,0,0,0,68,124,255,239,30,12,8,8,8,2,252,255,135,12,8,8,8,0,22,74,74,74,82,84,74,42,42,67,240,102,240,102,0,0,0,0,69,68,40,148,81,53,214,88,16,4,72,178,93,18,112,174,169,71,5,255,255,202,101,146,40,130,0,64,0,0,0,129,92,0,0,19,112,1,2,0,3,85,92,96,255,4,46,92,96,255,5,204,92,96,255,6,18,93,104,255,3,62,92,96,255,255,30,255,255,248,143,136,145,170,145,170,149,138,133,144,145,213,185,213,85,209,69,137,57,137,3,168,171,170,171,138,137,255,255,172,93,172,104,8,8,62,95,95,71,97,62,63,248,70,233,92,96,0,233,238,194,76,93,104,0,72,78,67,168,93,104,0,164,186,5,178,92,96,0,177,181,255,0,0,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,112,0,80,0,124,0,52,0,62,0,62,0,24,0,60,0,126,0,126,0,247,0,251,0,60,0,118,0,110,0,119,0,28,0,20,0,31,0,13,0,15,128,15,128,6,0,15,0,27,128,27,128,27,128,29,128,15,0,6,0,6,0,7,0,7,0,5,0,7,192,3,64,3,224,3,224,1,128,3,192,7,224,7,224,15,112,15,176,3,192,7,96,6,224,7,112,1,192,1,64,1,240,0,208,0,248,0,248,0,96,0,240,1,248,3,252,7,254,6,246,0,248,1,218,3,14,3,132,3,128,6,128,15,128,11,0,31,0,31,0,6,0,15,0,31,128,63,192,127,224,111,96,31,0,91,128,112,192,33,192,0,224,1,160,3,224,2,192,7,192,7,192,1,128,3,192,7,224,7,224,14,240,13,240,3,192,6,224,7,96,14,224,0,56,0,104,0,248,0,176,1,240,1,240,0,96,0,240,1,248,1,216,1,216,1,184,0,240,0,96,0,96,0,224,0,14,0,26,0,62,0,44,0,124,0,124,0,24,0,60,0,126,0,126,0,239,0,223,0,60,0,110,0,118,0,238,14,14,14,14,14,14,14,0,0,0,0,0,0,0,0,0,0,0,0,66,0,0,0,0,0,0,0,0,0,0,0,14,14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,70,0,0,0,0,0,0,0,0,0,0,0,14,14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,14,14,65,65,65,65,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,14,14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,14,14,0,0,0,0,65,65,65,65,65,65,0,0,0,0,65,65,69,69,69,69,69,69,69,65,65,0,0,0,0,0,14,14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,66,0,0,0,0,65,65,14,14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,66,0,0,0,0,0,0,14,14,65,65,0,0,6,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,66,0,0,0,0,65,65,14,14,0,0,0,0,0,0,0,0,0,0,65,65,65,65,65,65,65,65,65,0,0,0,0,70,0,0,0,0,0,0,14,14,0,0,0,0,0,0,0,0,0,0,0,66,0,0,0,0,0,0,66,0,0,0,0,0,0,0,0,65,0,0,14,14,0,0,0,0,0,1,1,1,65,0,0,66,0,0,0,0,0,0,70,0,0,0,0,0,0,0,0,0,0,0,14,14,0,0,0,0,0,0,0,0,0,0,0,70,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,65,65,65,14,14,65,65,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,65,65,65,0,0,0,0,0,14,14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,14,14,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,14,65,116,116,97,99,107,32,111,102,32,116,104,101,32,77,117,116,97,110,116,32,84,101,108,101,112,104,111,110,101,115,32,0,0,0,0,0,0,0,0,0,65,255,255,219,110,197,64,0,0,1,255,219,165,36,82,32,8,0,14,170,85,170,85,170,85,170,85,6,254,102,254,0,0,0,0,0,70,16,16,214,56,214,56,84,146,66,16,16,16,16,16,16,16,16,69,255,255,255,255,170,0,0,0,16,0,0,0,35,92,0,0,5,120,2,2,0,3,24,92,96,255,4,62,92,96,255,5,129,92,96,255,6,211,92,96,255,3,190,93,104,255,255,86,255,255,218,171,234,107,255,255,144,9,144,9,255,255,144,9,144,9,255,255,144,9,144,9,255,255,144,9,144,9,255,255,33,92,33,96,60,90,149,213,213,213,90,60,63,128,70,111,92,96,0,111,120,196,238,92,96,0,238,242,66,175,93,104,7,165,179,255,0,0,0,0,0,0,255,0,0,67,0,8,12,2,2,56,4,1,32,3,1,32,100,6,2,48,21,1,48,100,66,3,48,26,253,4,100,255,0,0,0,0,0,0,0,0,0,0,63,252,99,198,235,215,232,23,15,240,7,224,12,48,11,208,27,216,28,56,63,252,63,252,63,252,63,252,60,0,127,192,127,248,99,198,8,87,8,23,15,247,7,224,12,48,11,208,27,216,28,56,63,252,63,252,63,252,63,252,0,0,0,0,63,252,99,198,235,215,232,23,15,240,7,224,12,48,11,208,27,216,28,56,63,252,63,252,63,252,63,252,0,60,3,254,31,254,99,198,234,16,232,16,239,240,7,224,12,48,11,208,27,216,28,56,63,252,63,252,63,252,63,252,12,0,22,0,45,0,76,128,140,64,140,64,76,128,45,0,22,0,12,0,55,0,76,0,127,192,255,192,64,128,46,0,3,0,3,0,5,128,7,128,11,64,11,64,7,128,5,128,3,0,3,0,14,192,3,32,63,224,63,240,16,32,7,64,0,192,0,192,0,192,0,192,0,128,0,128,0,192,0,192,0,192,0,192,1,208,4,200,15,252,15,248,0,8,3,176,0,48,0,104,0,180,0,180,1,50,1,50,0,180,0,180,0,104,0,48,0,184,1,50,3,255,1,255,1,0,0,220,101,0,5,0,0,0,6,0,0,0,5,0,0,0,0,0,0,101,6,0,0,101,0,0,0,0,0,0,0,0,0,101,101,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,101,101,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,101,101,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,101,101,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,101,101,67,67,67,0,0,0,0,0,3,3,3,3,3,101,0,0,101,3,3,3,3,3,3,67,67,0,0,0,0,0,101,101,0,0,0,0,0,0,0,0,0,0,0,0,0,101,0,0,101,0,0,0,0,0,0,0,0,0,0,0,0,67,101,101,0,0,0,0,0,67,67,0,0,0,0,0,0,101,0,0,101,0,0,0,0,0,0,0,0,0,0,0,0,0,101,101,0,0,67,0,0,0,0,0,0,0,0,0,0,101,0,0,101,0,0,0,0,0,0,0,67,67,67,67,67,67,101,101,0,0,0,0,0,0,0,0,0,67,67,67,67,101,0,0,101,0,0,0,0,0,0,0,0,0,0,0,0,0,101,101,0,0,0,0,0,67,0,0,0,0,0,0,0,0,0,0,101,67,67,67,0,0,0,0,0,0,0,0,0,0,101,101,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,101,0,0,0,0,0,0,0,67,67,0,0,0,0,101,101,67,67,67,67,67,67,0,0,0,0,0,0,0,0,0,0,101,0,0,0,0,0,4,0,0,0,0,4,0,0,101,101,0,0,0,0,0,0,0,0,0,0,67,67,67,101,0,0,101,70,70,70,70,70,70,70,70,70,70,70,0,0,101,101,0,0,0,0,0,0,0,0,0,0,0,0,0,101,0,0,101,0,0,0,0,0,0,0,0,0,0,0,0,0,101,101,67,67,67,67,67,67,67,67,67,67,67,67,67,101,101,101,101,67,67,67,67,67,67,67,67,67,67,67,67,67,101,32,82,101,116,117,114,110,32,111,102,32,116,104,101,32,65,108,105,101,110,32,75,111,110,103,32,66,101,97,115,116,32,0,0,0,0,0,0,0,0,0,67,255,255,219,110,197,64,0,0,3,255,219,165,36,82,32,8,0,101,34,255,136,255,34,255,136,255,70,240,102,240,170,0,0,0,0,4,68,40,148,81,53,214,88,16,5,126,60,28,24,24,8,8,8,6,255,129,129,66,60,16,96,96,208,0,0,0,162,93,0,1,178,120,11,2,0,3,111,92,96,255,4,240,92,96,255,5,194,92,96,255,6,189,93,104,255,3,186,92,96,255,255,94,255,255,128,1,143,241,143,241,143,241,143,241,143,241,140,49,140,49,143,241,143,241,143,241,143,241,143,241,128,1,255,255,175,93,175,104,128,192,236,114,40,84,138,135,63,128,68,169,93,104,7,161,169,198,107,93,104,0,107,111,0,0,0,0,0,0,0,5,217,92,96,0,217,220,255,0,0,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,19,200,29,184,15,240,6,96,5,160,2,64,7,224,15,240,31,248,51,204,99,198,70,98,44,52,6,96,2,64,14,112,11,208,13,176,15,240,6,96,5,160,2,64,3,192,31,248,127,254,231,231,131,193,199,227,6,96,12,48,8,16,56,28,28,56,6,96,12,48,102,102,35,196,103,230,55,236,31,248,15,240,7,224,2,64,5,160,6,96,15,240,13,176,11,208,112,14,24,24,12,48,6,96,99,198,39,228,103,230,55,236,31,248,15,240,2,64,5,160,22,104,15,240,13,176,3,192,8,0,5,0,8,128,37,0,72,128,33,0,76,0,51,0,68,128,68,128,136,64,132,64,72,128,72,128,51,0,12,0,2,0,17,32,10,64,17,32,10,64,16,32,3,0,12,192,16,32,16,96,34,144,37,16,24,32,16,32,12,192,3,0,0,64,2,32,4,72,2,36,4,72,2,4,0,200,3,48,4,8,4,8,11,68,8,180,4,8,4,8,3,48,0,192,0,68,1,34,2,68,1,34,2,68,1,2,2,48,0,204,1,66,1,34,2,17,2,33,1,18,1,10,0,204,0,48,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,22,0,0,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,6,0,0,0,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,0,0,5,5,5,5,22,22,0,0,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,6,0,0,0,5,5,0,0,5,5,5,5,0,0,5,5,5,5,5,0,0,5,5,5,5,0,0,5,22,22,0,0,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,6,0,0,0,5,5,5,5,5,0,0,5,5,5,0,0,0,5,5,5,5,5,0,0,5,5,5,5,22,22,0,0,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,6,0,0,0,5,5,5,0,0,5,5,5,0,0,5,5,5,5,0,0,5,5,5,5,0,0,5,5,22,22,0,0,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,5,5,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,5,5,22,32,32,32,32,32,32,32,32,32,32,79,114,101,32,82,101,102,105,110,101,114,121,32,32,32,32,32,32,32,32,32,32,0,0,0,0,0,0,0,0,0,5,255,255,17,34,68,136,255,255,66,255,219,165,36,82,32,8,0,22,90,90,90,90,90,90,90,90,4,240,102,240,102,0,0,0,0,68,68,40,148,81,53,214,88,16,69,126,60,28,24,24,8,8,8,6,255,129,129,129,129,129,129,129,208,0,0,0,189,93,0,1,227,120,26,1,0,3,122,92,96,255,4,202,92,96,255,5,51,93,104,255,6,58,93,104,255,3,139,93,104,255,255,79,3,192,7,224,15,240,9,144,9,144,7,224,5,160,2,64,97,134,248,31,254,127,5,224,7,160,254,127,248,31,96,6,161,93,161,104,24,110,66,219,201,98,126,24,63,252,67,39,92,96,0,39,61,196,144,92,96,0,135,157,70,244,92,96,7,234,250,194,82,93,104,0,71,93,255,0,0,71,0,8,5,2,8,100,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,192,12,48,16,8,32,4,64,2,128,1,64,2,32,4,208,11,44,52,75,210,18,72,2,64,0,0,0,0,0,0,3,192,12,48,16,8,32,4,64,2,248,31,87,234,43,212,18,72,12,48,3,192,0,0,0,0,4,32,4,32,18,72,75,210,44,52,147,201,167,229,70,98,134,97,71,226,35,196,16,8,12,48,3,192,0,0,0,0,0,0,0,0,0,0,3,192,12,48,18,72,42,84,95,250,246,127,71,226,35,196,16,8,12,48,3,192,0,0,0,0,97,128,178,64,179,192,97,128,12,0,255,192,82,128,18,0,18,0,30,0,12,0,12,0,12,0,12,0,30,0,63,0,24,96,36,208,60,208,24,96,3,0,63,240,20,160,4,128,4,128,7,128,3,0,3,0,7,128,15,192,0,0,0,0,6,24,13,60,13,36,6,24,0,192,15,252,5,40,1,32,1,32,1,224,1,224,3,240,0,0,0,0,0,0,0,0,1,134,3,203,2,75,1,134,0,48,3,255,1,74,0,72,0,72,0,120,0,48,0,48,0,120,0,252,0,0,0,0,104,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,104,104,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,104,104,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,104,104,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,104,104,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,104,104,8,8,8,8,8,8,8,8,8,8,8,8,8,8,76,12,8,8,8,8,8,8,8,8,8,8,8,8,8,8,104,104,8,8,76,12,8,8,8,8,8,8,76,12,8,8,8,8,8,8,76,12,8,8,8,8,8,8,76,12,8,8,104,104,8,8,8,8,8,8,76,12,8,8,8,8,8,8,8,8,8,8,8,8,8,8,76,12,8,8,8,8,8,8,104,104,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,104,104,8,8,8,8,76,12,8,8,8,8,8,8,76,12,8,8,8,8,8,8,76,12,8,8,8,8,8,8,76,12,104,104,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,104,104,76,12,8,8,8,8,8,8,76,12,8,8,8,8,75,75,75,75,75,75,8,8,8,8,76,12,8,8,8,8,104,104,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,104,104,8,8,8,8,8,8,76,12,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,104,104,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,104,32,32,32,32,32,32,32,83,107,121,108,97,98,32,76,97,110,100,105,110,103,32,66,97,121,32,32,32,32,32,32,32,8,0,0,0,0,0,0,0,0,76,255,255,98,100,120,112,96,96,2,252,255,255,135,255,8,8,0,104,1,130,196,232,224,216,188,126,75,240,102,240,102,0,0,0,0,0,68,40,148,81,53,214,88,16,0,72,178,93,18,112,174,169,71,12,255,255,70,38,30,14,6,6,208,0,0,0,189,93,0,0,111,120,6,6,0,11,87,92,96,255,12,3,93,104,255,13,251,92,96,255,14,240,92,96,255,0,255,255,255,255,255,30,255,255,255,255,252,63,248,31,240,15,224,7,193,131,194,67,194,67,193,131,224,7,240,15,248,31,252,63,255,255,255,255,15,92,15,96,170,170,254,254,254,254,170,170,63,248,255,233,92,96,0,233,238,194,76,93,104,0,72,78,67,168,93,104,0,164,186,0,0,0,0,0,0,0,255,0,0,15,0,0,1,4,0,72,13,0,0,11,1,0,32,14,0,2,21,3,2,56,255,0,0,0,0,0,0,0,0,0,0,0,0,0,3,192,255,255,171,213,255,255,19,200,41,148,21,168,11,208,5,160,3,192,3,192,5,160,10,80,20,40,40,20,16,8,0,0,0,0,3,192,255,255,171,213,255,255,19,200,41,148,21,168,11,208,5,160,3,192,3,192,37,160,74,84,20,42,0,0,0,0,0,0,0,7,3,253,255,215,171,248,255,192,3,192,1,128,21,164,75,210,5,164,35,194,11,208,37,168,0,0,0,0,0,0,0,32,2,2,0,21,3,206,15,212,203,200,183,194,227,200,49,129,7,228,195,200,23,194,35,252,0,0,1,0,0,0,8,32,0,0,0,0,33,2,0,17,3,138,14,144,75,192,55,2,98,192,49,1,5,226,195,68,0,0,0,0,0,0,0,0,0,0,2,0,0,0,0,32,16,8,10,132,0,32,101,0,34,104,8,160,3,208,23,224,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,32,16,0,0,0,5,16,0,104,34,160,13,208,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,128,0,32,8,0,2,192,7,96,14,0,0,0,0,0,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,6,14,14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,6,14,14,0,0,0,0,0,0,0,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,69,65,65,65,65,65,6,6,14,14,0,0,0,0,0,0,0,66,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,66,6,6,14,14,65,65,65,65,65,0,0,70,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,66,6,6,14,14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,65,65,0,0,66,6,6,14,14,0,0,0,0,0,0,1,0,0,0,0,65,65,0,0,0,0,0,0,0,0,0,0,0,0,0,0,66,6,6,14,14,0,0,65,65,0,0,0,0,0,0,0,0,0,0,0,0,0,65,65,0,0,0,0,0,0,0,0,66,6,6,14,14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,65,65,0,66,6,6,14,14,65,65,0,0,0,0,0,0,0,0,0,65,65,0,0,0,0,0,0,0,0,0,0,0,0,0,0,70,6,6,14,14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,65,65,0,0,0,0,0,0,0,0,0,6,6,14,14,0,0,0,0,65,65,65,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,65,65,0,0,0,0,6,6,14,14,0,0,0,0,0,0,0,0,0,0,0,65,65,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,6,14,14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,6,14,14,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,14,32,32,32,32,32,32,32,32,32,32,32,32,84,104,101,32,66,97,110,107,32,32,32,32,32,32,32,32,32,32,32,32,0,0,0,0,0,0,0,0,0,65,255,255,221,119,170,85,34,0,1,255,219,165,36,82,32,8,0,14,170,85,170,85,170,85,170,85,69,254,102,254,0,0,0,0,0,70,16,16,214,56,214,56,84,146,66,16,16,16,16,16,16,16,16,6,255,255,24,24,24,24,24,24,208,0,0,0,162,93,0,0,104,112,16,2,0,3,89,92,96,255,4,204,92,96,255,5,218,93,104,255,255,211,92,96,255,3,190,93,104,255,255,86,255,255,128,1,128,1,128,1,128,1,136,1,170,1,156,61,255,71,156,1,170,1,136,1,128,1,128,1,128,1,255,255,97,92,97,96,124,56,100,222,142,222,130,124,63,252,69,177,93,104,0,177,179,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,0,0,6,0,40,9,2,36,102,7,1,64,15,1,36,102,68,3,80,21,253,32,104,255,0,0,0,0,0,0,255,0,0,0,0,0,0,97,134,159,249,159,249,97,134,3,192,255,255,128,1,170,169,159,253,181,89,144,13,181,89,159,253,170,169,128,1,255,255,29,184,34,244,34,244,29,184,3,192,255,255,213,85,191,255,234,173,176,7,229,77,176,7,234,173,191,255,213,85,255,255,7,224,8,16,8,16,7,224,3,192,255,255,255,255,213,87,224,3,202,167,231,243,202,167,224,3,213,87,255,255,255,255,29,184,47,68,47,68,29,184,3,192,255,255,170,171,192,1,149,83,207,249,154,179,207,249,149,83,192,1,170,171,255,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,192,129,192,255,192,130,64,254,64,255,192,0,0,0,0,0,0,0,0,0,0,0,0,63,240,32,112,63,240,32,144,63,144,63,240,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,15,252,8,28,15,252,8,36,15,228,15,252,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,255,2,7,3,255,2,9,3,249,3,255,0,0,0,0,0,0,0,0,101,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,101,101,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,101,101,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,101,101,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,101,101,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,101,101,66,0,0,0,0,66,0,0,0,0,101,0,0,101,0,0,0,0,0,0,0,66,66,66,0,0,0,0,0,0,101,101,0,0,0,0,0,0,0,0,0,0,101,0,0,101,101,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,101,101,0,0,0,66,0,0,0,0,0,0,101,0,0,101,101,101,0,0,0,0,0,0,0,0,66,66,66,66,66,66,101,101,0,0,0,0,0,0,0,0,0,0,101,0,0,101,101,101,101,0,0,0,0,0,0,0,0,0,0,0,0,0,101,101,2,2,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,0,0,0,0,101,101,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,101,101,0,0,0,0,0,0,0,0,0,101,101,66,66,0,0,0,0,0,0,0,0,0,0,0,0,66,0,0,0,0,101,101,66,66,66,66,66,66,66,66,66,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,101,101,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,66,0,0,0,0,0,66,0,0,0,0,101,101,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,4,4,0,0,0,0,0,101,101,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,101,32,32,32,32,32,32,84,104,101,32,83,105,120,116,101,101,110,116,104,32,67,97,118,101,114,110,32,32,32,32,32,32,0,0,0,0,0,0,0,0,0,66,255,255,219,110,197,64,0,0,2,255,219,165,36,82,32,8,0,101,73,249,79,73,255,72,120,207,70,240,102,240,170,0,0,0,0,4,68,68,68,68,102,238,238,255,5,126,60,28,24,24,8,8,8,6,255,129,129,66,60,16,96,96,208,0,0,0,162,93,0,0,35,120,24,2,0,3,94,92,96,255,4,237,92,96,255,5,1,92,96,255,6,81,93,104,255,255,186,92,96,255,255,94,255,255,129,129,129,129,255,255,129,129,129,129,255,255,129,129,129,129,255,255,129,129,129,129,255,255,129,129,129,129,255,255,172,92,172,96,15,9,61,39,244,156,144,240,63,248,68,169,93,104,0,161,178,6,65,93,104,0,65,71,67,242,92,96,0,242,247,133,186,92,96,0,185,189,255,0,0,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,8,0,20,0,42,0,85,0,74,0,132,0,128,192,128,192,65,0,127,128,63,192,31,128,15,0,10,128,18,64,42,0,21,0,42,0,21,0,32,0,32,0,32,0,32,48,32,48,16,64,31,224,15,240,7,224,3,192,2,160,4,144,0,0,16,0,40,0,84,0,170,0,81,0,33,0,1,12,2,12,2,16,3,248,3,252,1,248,0,240,0,168,1,36,5,64,10,128,5,64,10,128,0,64,0,64,0,64,0,67,0,131,0,132,0,254,0,255,0,126,0,60,0,42,0,73,2,160,1,80,2,160,1,80,2,0,2,0,2,0,194,0,193,0,33,0,127,0,255,0,126,0,60,0,84,0,146,0,0,0,0,8,0,20,0,42,0,85,0,138,0,132,48,128,48,64,8,64,31,192,63,192,31,128,15,0,21,0,36,128,0,84,0,168,0,84,0,168,0,4,0,4,0,4,12,4,12,4,2,8,7,248,15,240,7,224,3,192,5,64,9,32,0,0,0,16,0,40,0,84,0,170,0,82,0,33,3,1,3,1,0,130,1,254,3,252,1,248,0,240,1,80,2,72,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,6,0,0,6,0,0,0,6,0,0,6,0,0,0,0,0,6,0,6,0,0,0,0,0,0,22,22,4,4,68,68,68,68,68,68,68,0,0,68,68,68,68,68,68,68,0,0,68,68,68,0,68,68,0,0,4,4,22,22,68,68,33,68,68,68,68,68,68,0,0,68,68,68,68,68,68,68,0,0,68,68,68,68,68,68,0,0,68,68,22,22,68,68,68,68,68,68,68,68,68,0,0,68,68,68,0,68,68,68,0,0,68,68,68,68,68,33,0,0,68,68,22,22,68,68,0,0,68,68,68,68,68,0,0,68,68,32,32,32,32,32,0,0,68,68,68,68,68,68,0,0,68,68,22,22,0,68,0,0,68,68,68,68,68,0,0,68,68,68,68,68,68,68,0,0,68,68,68,68,68,68,0,0,68,68,22,22,68,68,0,0,68,68,68,68,68,0,0,68,68,68,68,68,68,68,0,68,68,33,68,68,68,68,0,0,68,68,22,22,68,68,0,0,68,68,68,68,33,0,0,68,68,68,68,68,68,68,68,68,68,68,68,68,68,0,0,0,68,68,22,22,68,68,0,0,68,68,68,68,68,0,0,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,0,0,68,68,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,4,4,4,22,22,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,22,32,32,32,32,32,32,32,32,32,84,104,101,32,87,97,114,101,104,111,117,115,101,32,32,32,32,32,32,32,32,32,32,0,0,0,0,0,0,0,0,0,4,255,255,219,110,197,64,0,0,68,255,170,85,170,85,170,85,170,22,255,153,187,255,255,153,187,255,32,240,102,240,102,0,0,0,0,6,68,40,148,81,53,214,88,16,33,66,215,254,101,166,125,238,215,0,0,0,0,0,0,0,0,0,48,3,1,0,97,92,0,1,14,120,5,2,0,35,184,92,96,255,36,239,92,96,255,37,33,93,104,255,38,83,93,104,255,35,122,93,104,255,255,76,255,255,128,1,191,253,160,5,165,165,165,165,165,165,165,165,165,165,165,165,175,245,165,165,165,165,165,165,165,165,255,255,61,92,61,96,48,72,136,144,104,4,10,4,63,128,194,165,93,104,0,165,168,5,172,93,104,0,172,185,255,0,0,0,0,0,0,0,0,0,0,0,0,0,255,0,0,65,0,64,3,2,64,102,6,1,64,10,253,3,96,71,2,48,19,1,0,64,67,3,0,27,4,4,96,255,0,0,0,0,0,0,85,85,255,255,255,255,8,16,8,16,8,16,248,31,85,85,255,255,255,255,8,16,8,16,8,16,88,21,255,255,255,255,0,0,85,85,255,255,255,255,8,16,248,31,8,16,63,254,56,30,8,16,95,245,255,255,255,255,0,0,255,255,0,0,0,0,0,0,255,255,85,85,255,255,255,255,8,16,56,30,63,254,8,16,248,31,95,245,255,255,255,255,0,0,0,0,0,0,85,85,255,255,248,31,8,16,85,85,255,255,255,255,120,29,248,31,248,31,8,16,85,85,255,255,255,255,0,0,126,0,153,0,255,0,219,0,231,0,126,0,36,0,36,0,36,0,66,0,66,0,66,0,129,0,129,0,195,0,195,0,0,0,31,128,38,64,63,192,54,192,57,192,31,128,16,128,32,64,32,64,64,32,64,32,128,16,128,48,192,48,192,0,0,0,0,0,0,0,7,224,9,144,15,240,13,176,14,112,7,224,8,16,16,8,32,4,64,2,128,1,192,3,192,3,0,0,1,248,2,100,3,252,3,108,3,156,1,248,1,8,2,4,2,4,4,2,4,2,8,1,12,1,12,3,0,3,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,66,66,0,0,66,66,66,0,0,66,66,66,66,66,66,66,66,0,0,66,66,66,0,0,66,66,66,66,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,66,66,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,66,66,66,66,66,66,66,66,0,0,66,66,66,0,0,66,66,0,0,22,22,0,0,66,66,0,0,66,66,66,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,66,66,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,66,66,0,0,66,66,66,0,0,66,66,66,66,66,66,66,66,0,0,66,66,66,0,0,66,66,0,0,22,22,66,66,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,32,32,32,32,32,32,65,109,111,101,98,97,116,114,111,110,115,39,32,82,101,118,101,110,103,101,32,32,32,32,32,32,0,0,0,0,0,0,0,0,0,66,255,255,219,110,197,64,0,0,2,255,219,165,36,82,32,8,0,22,255,129,129,255,255,129,129,255,4,240,102,240,102,0,153,255,0,68,68,40,148,81,53,214,88,16,5,126,60,28,24,24,8,8,8,0,0,0,0,0,0,0,0,0,208,3,1,0,189,93,0,1,39,120,3,1,0,3,48,92,96,255,255,255,255,255,255,0,255,255,255,255,0,255,255,255,255,0,255,255,255,255,255,14,255,255,128,1,176,13,160,5,170,85,170,85,170,85,170,85,170,85,170,85,170,85,170,85,160,5,176,13,128,1,255,255,29,92,29,96,48,72,136,144,104,4,10,4,63,128,196,108,92,96,0,108,114,133,80,93,104,0,76,81,67,208,92,96,0,204,209,6,176,93,104,7,172,178,255,0,0,67,0,8,5,3,5,104,4,1,8,10,2,5,104,5,2,8,20,4,5,104,6,3,8,25,1,5,104,255,0,0,0,0,0,0,3,192,14,112,19,200,49,140,57,156,95,250,141,178,132,164,73,36,41,18,36,137,66,73,130,82,4,144,8,136,0,64,3,192,14,112,19,200,49,140,57,156,95,250,77,177,133,17,132,146,72,164,41,36,41,18,68,137,2,72,2,80,4,0,3,192,14,112,19,200,49,140,57,156,95,250,77,177,68,145,130,73,130,74,68,148,37,36,41,34,8,144,4,72,0,64,3,192,14,112,19,200,49,140,57,156,95,250,77,178,41,18,36,145,66,73,130,74,132,74,72,145,9,32,9,0,0,128,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,255,192,12,0,97,128,210,192,179,64,97,128,3,0,3,0,3,0,3,0,3,0,3,0,3,0,3,0,3,0,3,0,63,240,3,0,24,96,36,208,60,208,24,96,0,192,0,192,0,192,0,192,0,192,0,192,0,192,0,192,0,192,0,192,15,252,0,192,6,24,11,52,13,44,6,24,0,48,0,48,0,48,0,48,0,48,0,48,0,48,0,48,0,48,0,48,3,255,0,48,1,134,2,77,3,205,1,134,22,22,22,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,22,22,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,22,22,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,22,22,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,22,22,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,22,22,36,36,32,32,36,36,36,36,32,32,32,32,32,32,36,36,36,36,36,36,36,36,36,32,32,32,32,32,32,32,22,22,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,22,22,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,32,32,32,36,36,36,36,36,36,36,36,36,22,22,32,32,36,36,36,36,36,36,36,36,36,36,32,32,32,36,36,36,36,36,36,36,36,32,32,32,32,32,32,32,22,22,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,22,22,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,32,32,36,36,36,36,36,36,36,36,36,36,22,22,32,32,32,32,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,32,32,32,32,32,32,32,22,22,36,36,36,36,36,36,38,38,38,38,36,36,36,32,32,32,32,32,36,36,36,36,36,36,36,36,36,36,36,36,22,22,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,22,22,22,22,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,36,22,22,22,22,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,22,32,32,32,32,32,32,32,22,32,32,32,32,32,83,111,108,97,114,32,80,111,119,101,114,32,71,101,110,101,114,97,116,111,114,32,32,32,32,32,32,36,0,0,0,0,0,0,0,0,32,255,255,219,110,197,64,0,0,2,255,219,165,36,82,32,8,0,22,34,255,136,255,34,255,136,255,38,240,102,240,102,0,153,255,0,68,68,40,148,81,53,214,88,16,5,126,60,28,24,24,8,8,8,0,0,0,0,0,0,0,0,0,160,0,0,0,78,93,0,0,135,120,4,3,0,35,62,92,96,255,36,161,92,96,255,37,158,93,104,255,255,255,255,255,255,0,255,255,255,255,255,78,255,255,128,1,191,253,160,5,175,245,168,21,171,213,170,85,170,85,171,213,168,21,175,245,160,5,191,253,128,1,255,255,33,92,33,96,48,72,136,144,104,4,10,4,63,240,38,120,92,96,0,119,125,33,220,92,96,0,214,221,162,61,93,104,7,55,61,38,176,93,104,0,173,189,255,0,0,38,0,64,5,3,2,102,34,1,56,11,254,48,102,33,2,80,16,1,4,80,255,0,0,0,0,0,0,0,0,0,0,0,0,0,3,64,15,112,63,60,63,76,95,102,95,118,159,127,0,127,142,0,142,255,70,254,64,242,32,4,48,12,12,48,2,192,3,192,15,240,63,172,63,204,95,198,71,182,153,191,158,127,142,127,141,159,69,230,65,242,32,4,48,12,12,48,3,192,3,192,15,240,47,188,55,200,91,230,93,230,158,223,158,63,140,127,139,127,71,190,65,194,0,4,48,4,12,48,3,192,3,192,11,240,61,188,61,204,93,230,94,244,158,227,158,31,136,127,135,127,7,126,65,178,32,4,48,12,12,16,3,192,6,0,12,0,24,0,56,0,116,0,202,128,133,192,3,192,6,64,206,192,216,64,255,192,226,0,200,128,213,64,8,128,1,128,3,0,6,0,14,0,29,0,50,160,33,112,0,240,1,144,99,176,102,16,127,240,120,128,98,32,101,80,2,32,0,96,0,192,1,128,3,128,7,64,12,168,8,92,0,60,0,100,48,236,49,132,63,252,62,32,48,136,49,84,0,136,0,24,0,48,0,96,0,224,1,208,3,42,2,23,0,15,0,25,6,59,6,97,7,255,7,136,6,34,6,85,0,34,44,34,34,34,34,34,44,40,40,40,40,40,47,47,47,47,47,40,40,40,40,40,46,50,50,46,40,40,40,40,40,40,44,34,34,34,34,34,44,40,40,47,40,40,47,47,47,47,47,40,40,40,40,40,58,56,56,58,40,40,40,42,42,42,44,34,34,22,34,44,46,46,46,46,46,46,47,47,47,47,47,46,43,46,43,46,58,56,56,58,47,47,47,42,42,42,40,44,44,22,44,46,46,46,46,46,46,46,46,40,40,40,44,44,44,44,44,44,58,58,58,58,47,47,47,40,42,40,40,47,40,22,40,46,46,46,46,46,46,46,46,44,44,44,38,38,38,38,38,38,38,38,38,38,38,38,38,38,38,38,40,44,44,22,44,46,46,46,46,46,46,46,46,39,38,38,38,38,38,0,0,38,0,0,0,0,0,0,0,0,0,38,12,38,38,38,38,33,33,33,14,14,33,33,33,39,38,38,38,38,38,0,0,38,0,0,0,0,0,0,0,0,0,38,38,38,38,38,38,38,38,38,38,38,38,38,38,38,38,38,38,38,38,0,0,38,0,0,0,0,0,0,0,0,0,38,38,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,66,66,38,38,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,38,38,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,0,0,0,2,0,0,0,0,38,38,0,0,0,0,0,0,0,0,68,0,0,68,0,0,0,0,68,0,0,0,68,0,0,0,0,0,0,66,0,0,38,38,66,66,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,38,38,0,0,0,0,66,66,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,38,38,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,38,38,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,38,32,32,32,32,32,32,32,32,84,104,101,32,70,105,110,97,108,32,66,97,114,114,105,101,114,32,32,32,32,32,32,32,0,0,0,0,0,0,0,0,0,66,255,255,219,110,197,64,0,0,2,255,219,165,36,82,32,8,0,38,34,255,136,255,34,255,136,255,5,240,102,240,102,0,153,255,0,68,16,16,214,56,214,56,84,146,10,126,60,28,24,24,8,8,8,0,0,0,0,0,0,0,0,0,208,0,1,0,187,93,0,1,65,120,22,2,0,3,183,92,96,255,4,222,92,96,255,5,106,93,104,255,6,110,93,104,255,3,115,93,104,255,255,30,0,0,7,224,24,24,35,196,68,34,72,18,72,18,72,18,68,34,34,68,26,88,74,82,122,94,66,66,126,126,0,0,179,92,179,96,48,72,136,144,104,4,10,4,63,252,70,167,93,104,0,167,182,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,0,0,7,0,48,24,1,40,103,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,192,12,48,16,8,32,4,64,2,128,1,64,2,32,4,208,11,44,52,75,210,18,72,2,64,0,0,0,0,0,0,3,192,12,48,16,8,32,4,64,2,248,31,87,234,43,212,18,72,12,48,3,192,0,0,0,0,4,32,4,32,18,72,75,210,44,52,147,201,167,229,70,98,134,97,71,226,35,196,16,8,12,48,3,192,0,0,0,0,0,0,0,0,0,0,3,192,12,48,18,72,42,84,95,250,246,127,71,226,35,196,16,8,12,48,3,192,0,0,0,0,18,0,12,0,30,0,191,64,115,128,115,128,191,64,94,128,76,128,82,128,127,128,12,0,97,128,146,192,178,64,97,128,3,0,7,128,7,128,28,224,59,112,59,112,28,224,23,160,23,160,19,32,31,224,3,0,24,96,36,144,52,176,24,96,1,224,1,224,1,32,14,220,13,236,13,236,14,220,5,40,5,232,5,232,7,248,0,192,6,24,13,36,9,52,6,24,0,120,0,72,0,48,3,123,2,253,2,253,3,123,1,50,1,74,1,122,1,254,0,48,1,134,2,205,2,73,1,134]);
