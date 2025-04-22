let STDIN = "";
let STDIN_REMAINING = "";

let STDOUT = "";

const REGISTER_NAMES = [
	{ ref: '$0', short: 'zero', long: 'zero' },
	{ ref: '$1', short: 'at', long: 'assembler temporary' },
	{ ref: '$2', short: 'v0', long: 'result 0' },
	{ ref: '$3', short: 'v1', long: 'result 1' },
	{ ref: '$4', short: 'a0', long: 'argument 0' },
	{ ref: '$5', short: 'a1', long: 'argument 1' },
	{ ref: '$6', short: 'a2', long: 'argument 2' },
	{ ref: '$7', short: 'a3', long: 'argument 3' },
	{ ref: '$8', short: 't0', long: 'temporary 0' },
	{ ref: '$9', short: 't1', long: 'temporary 1' },
	{ ref: '$10', short: 't2', long: 'temporary 2' },
	{ ref: '$11', short: 't3', long: 'temporary 3' },
	{ ref: '$12', short: 't4', long: 'temporary 4' },
	{ ref: '$13', short: 't5', long: 'temporary 5' },
	{ ref: '$14', short: 't6', long: 'temporary 6' },
	{ ref: '$15', short: 't7', long: 'temporary 7' },
	{ ref: '$16', short: 's0', long: 'saved 0' },
	{ ref: '$17', short: 's1', long: 'saved 1' },
	{ ref: '$18', short: 's2', long: 'saved 2' },
	{ ref: '$19', short: 's3', long: 'saved 3' },
	{ ref: '$20', short: 's4', long: 'saved 4' },
	{ ref: '$21', short: 's5', long: 'saved 5' },
	{ ref: '$22', short: 's6', long: 'saved 6' },
	{ ref: '$23', short: 's7', long: 'saved 7' },
	{ ref: '$24', short: 't8', long: 'temporary 8' },
	{ ref: '$25', short: 't9', long: 'temporary 9' },
	{ ref: '$26', short: 'k0', long: 'kernel 0' },
	{ ref: '$27', short: 'k1', long: 'kernel 1' },
	{ ref: '$28', short: 'gp', long: 'global pointer' },
	{ ref: '$29', short: 'sp', long: 'stack pointer' },
	{ ref: '$30', short: 'fp', long: 'frame / UoW stack pointer' },
	{ ref: '$31', short: 'ra', long: 'return address' },
	{ ref: '!hi', short: 'hi', long: 'High / Remainder' },
	{ ref: '!lo', short: 'lo', long: 'Low / Quotient' },
	{ ref: '!pc', short: 'pc', long: 'program counter' },
];

const REGISTER_MAP = {};
for (let register of REGISTER_NAMES) {
	if (register.ref.startsWith('$')) {
		const registerId = register.ref.substring(1);
		register.number = parseInt(registerId);
		REGISTER_MAP[register.ref] = register;
		REGISTER_MAP[registerId] = register;
		REGISTER_MAP[register.short] = register;
		REGISTER_MAP[register.short.toUpperCase()] = register;
	}
}

let REGISTERS = new Array(34).fill(0);
const MEMORY = new Memory();
let LABELS = {};
let REGISTER_INITIAL_VALUES = {};

function jumpTo(address) {
	REGISTERS[34] = address;
}

function getPC() {
	return REGISTERS[34];
}

function restartAssembly() {
	LABELS = {};
	STDIN = "";
	STDIN_REMAINING = "";
	REGISTER_INITIAL_VALUES = {};
	STDOUT = "";
}

function assembleLine(lineNumber, address, line) {
	let result = {
		lineNumber: lineNumber,
		forcedAddress: null,
		address: address,
		line: line,
		label: null,
		mnemonic: null,
		instruction: null,
		args: null,
		comment: null,
		length: 0,
		nextAddress: address,
		dword: null,
		gutter: '',
	}

	let trimmed = line.trim();

	if (trimmed.length === 0) {
		return result;
	}

	if (trimmed.startsWith(';<<')) {
		// This is a directive to append content to STDIN
		// and not an instruction.

		raw = trimmed.slice(3).trim();
		[text, next,] = parseText(raw, 0);
		if (next !== raw.length) {
			result.gutter = " Invalid text literal"
			return result;
		}
		STDIN += text;
		STDIN_REMAINING = STDIN;

		result.gutter = "STDIN \u27f5 " + 
			raw.replaceAll('\\t', '\u2b72')
			   .replaceAll('\\n', '\u2b07')
			   .replaceAll('\\r', '\u2b05');

		for (let controlCode = 0; controlCode < 32; controlCode++) {
			raw = raw.replaceAll(String.fromCharCode(controlCode), String.fromCharCode(0x2400 + controlCode));
		}
		
		return result;
	} else if (trimmed.startsWith(';!!')) {
		// This is a directive to initialize a register to a numeric value or a label.

		const [, regStart,] = parseSeparator(trimmed, 3);
		const [registerNumber, operatorStart, regSource] = parseRegister(trimmed, regStart);
		const [operator, valueStart, operatorSource] = parseSeparator(trimmed, operatorStart, '(=|\u27f5|(<[=-]+))');
		const [value, valueEnd, valueSource] = parseAddress(trimmed, valueStart);

		if (typeof value === 'number') {
			REGISTER_INITIAL_VALUES['$' + registerNumber] = new NumberLiteral(value, valueSource);
		} else {
			REGISTER_INITIAL_VALUES['$' + registerNumber] = new LabelReference(value, valueSource);
		}

		result.gutter = `$${registerNumber} \u27f5 ${valueSource} initially`;
		return result;
	} else if (trimmed.startsWith(';??')) {
		// An assertion directive to check if all is good
		let a, operator, b

		try {
			const [, aStart,] = parseSeparator(trimmed, 3);
			const [a, operatorStart, aSource] = parseArg(trimmed, aStart);
			const [operator, bStart,] = parseSeparator(trimmed, operatorStart, '((<=)|<|(==)|(>=)|>|(!=))');
			const [b, end, bSource] = parseArg(trimmed, bStart);

			result.args = [a, operator, b];
			result.instruction = new AssertInstruction(result.address, a, operator, b, trimmed);
			result.length = 4;
			result.nextAddress = result.address + result.length;

			MEMORY.write(result.address, result.instruction);

			result.gutter = result.address.toString(16).padStart(8, '.') + ": " + result.instruction.opcode + " | " + result.instruction.description;
			return result;
		} catch (e) {
			result.gutter = "Doesn't look like: ;?? a <|<=|==|!=|=>|> b.";
			return result;
		}
	}

	const forcedAddress = trimmed.match(/^(([1-9][0-9]*)|(0[bB][01]+)|(0[0-7]*)|(0[xX][0-9A-Fa-f]+)):/);
	if (forcedAddress) {
		const [newAddress, end,] = parseNumber(trimmed, 0);
		trimmed = trimmed.slice(forcedAddress[0].length).trim();
		result.forcedAddress = newAddress;
		result.address = newAddress;
		result.nextAddress = newAddress;
		result.gutter += " Continue from 0x" + newAddress.toString(16) + '.';
	}

	const label = trimmed.match(/^[A-Za-z_][A-Za-z0-9_]*:/);
	if (label) {
		const name = label[0].slice(0, -1);
		result.label = name;
		if (name in LABELS) {
			result.gutter += " Duplicate label!";
		} else {
			LABELS[name] = result.address;
		}
		trimmed = trimmed.slice(label[0].length).trim();
	}

	if (trimmed.length === 0 || trimmed.startsWith(';')) {
		result.length = 0;
		if (result.label) {
			result.gutter = " " + result.address.toString(16).padStart(8, '.') + ": " + result.label + ":" + result.gutter;
		} else {
			result.gutter = line;
		}
	} else {
		result.length = 4;
		let pos = 0;
		[result.mnemonic, pos,] = parseMnemonic(trimmed, 0);

		try {
			result.args = parseArgs(trimmed.slice(pos));
		} catch (e) {
			result.args = null;
			result.gutter = e.message;
		}

		if (result.args != null) {
			try {
				result.instruction = createInstruction(result.address, result.mnemonic, result.args);
			} catch (e) {
				result.instruction = null;
				result.gutter = e.message;
			}
		}

		if (result.instruction && (result.args != null)) {
			if (result.instruction instanceof DotWordInstruction) {
				// will be handled during linking
				//MEMORY.write(result.address, result.instruction.i.read());
			} else {
				MEMORY.write(result.address, result.instruction);
			}
			result.gutter = result.address.toString(16).padStart(8, '.') + ": " + result.instruction.opcode + " | " + result.instruction.description + result.gutter;
		}
	}

	result.nextAddress = result.address + result.length;

	result.gutter = result.gutter.trim();

	return result;
}

function parseRegister(raw, start) {
	const len = raw.length;
	if (start >= len) {
		throw new Error("Register expected but end of line found");
	}

	if (raw[start] !== '$') {
		throw new Error("Register expected but found: " + raw.substring(start));
	}

	let pos = start + 1;
	let end = pos;

	const regIdMatch = /^([0-9A-Za-z]+).*/.exec(raw.substring(pos));

	if (regIdMatch) {
		const registerId = regIdMatch[1];

		if (registerId in REGISTER_MAP) {
			const registerIdLen = registerId.length;
			const end = pos + registerIdLen;
			return [REGISTER_MAP[registerId].number, end, raw.substring(start, end)];
		}

		throw new Error("Register doesn't exist: $" + registerId);
	}

	throw new Error("Register number expected but found: " + raw.substring(start));
}

function parseNumber(raw, start) {
	const len = raw.length;

	if (start >= len) {
		throw new Error("Number expected but end of line found");
	}

	let sign = raw[start] === '-' ? -1 : 1;
	let pos = start + ((sign < 0) ? 1 : 0);

	let base = 10;
	let digits = "0123456789";

	if (raw[start] === '0' && pos + 1 < len) {
		switch (raw[start + 1].toLowerCase()) {
			case 'x':
				base = 16;
				pos += 2;
				digits = "0123456789abcdef"
				break;
			case 'b':
				base = 2;
				pos += 2;
				digits = "01"
				break;
			default:
				base = 8;
				//pos += 0;
				digits = "01234567";
				break;
		}
	}

	let end = pos + 1;

	while ((end < len) && digits.indexOf(raw[end].toLowerCase()) >= 0) {
		end++;
	}

	if (end == pos) {
		throw new Error("Number expected: " + raw.substring(start));
	}

	return [sign * parseInt(raw.substring(pos, end), base), end, raw.substring(start, end)];
}

function parseRegisterInParentheses(raw, start) {
	const len = raw.length;
	if (start >= len) {
		throw new Error("Memory reference expected but end of line found");
	}

	if (raw[start] !== '(') {
		throw new Error("Memory reference expected but found: " + raw.substring(start));
	}

	let pos = start + 1;
	[registerNumber, pos,] = parseRegister(raw, pos);

	while (pos < len && raw[pos] === ' ') {
		pos++;
	}

	if (pos >= len) {
		throw new Error("Closing parenthesis expected but end of line found");
	}

	if (raw[pos] !== ')') {
		throw new Error("Closing parenthesis expected but found: " + raw.substring(pos));
	}

	const end = pos + 1;
	return [registerNumber, end, raw.substring(start, end)];
}

function parseMnemonic(raw, start) {
	const len = raw.length;
	if (start >= len) {
		throw new Error("Mnemonic expected but end of line found");
	}

	const match = /^[A-Za-z_.][A-Za-z0-9_.]*/.exec(raw.substring(start));

	if (match) {
		const mnemonic = match[0];
		const mnemonicLen = mnemonic.length;
		const end = start + mnemonicLen;
		return [mnemonic.toLowerCase(), start + mnemonicLen, raw.substring(start, end)];
	}

	throw new Error("Mnemonic expected but found: " + raw.substring(start));
}

function parseLabel(raw, start) {
	const len = raw.length;
	if (start >= len) {
		throw new Error("Label expected but end of line found");
	}

	const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(raw.substring(start));

	if (match) {
		const label = match[0];
		const labelLen = label.length;
		const end = start + labelLen;
		return [label, end, raw.substring(start, end)];
	}

	throw new Error("Label expected but found: " + raw.substring(start));
}

function parseText(raw, start) {
	const len = raw.length;
	if (start >= len) {
		throw new Error("Text expected but end of line found");
	}

	const match = /^("([^"\\]|\\[\\"'tnr])*")|('([^'\\]|\\[\\"'tnr])*')/.exec(raw.substring(start));

	if (match) {
		const text = match[0];
		const textLen = text.length;

		raw = text
			.substring(1, text.length - 1)
			.replaceAll(/\\'/g, "'")
			.replaceAll(/\\"/g, '"')
			.replaceAll(/\\t/g, '\t')
			.replaceAll(/\\n/g, '\n')
			.replaceAll(/\\r/g, '\r')
			.replaceAll(/\\\\/g, '\\');

		const end = start + textLen;

		return [raw, end, raw.substring(start, end)];
	}

	throw new Error("Text expected but found: " + raw.substring(start));
}

function parseSeparator(raw, start, expectSymbol) {
	const len = raw.length;
	if (start >= len) {
		throw new Error("Separator expected but end of line found");
	}

	const regex = expectSymbol ? ('[ \\t]*' + expectSymbol + "[ \\t]*") : '[ \\t]*';

	const pattern = new RegExp('^' + regex);

	const match = pattern.exec(raw.substring(start));

	if (match) {
		const sep = match[0];
		const sepLen = sep.length;
		const end = start + sepLen;
		return [sep.trim(), end, raw.substring(start, end)];
	}

	if (expectSymbol) {
		throw new Error("Comma expected but found: " + raw.substring(start));
	}

	return ["", start, start];
}

function parseAddress(raw, start) {
	const len = raw.length;

	if (start >= len) {
		throw new Error("Argument expected but end of line found");
	}

	const initial = raw[start]

	if ("-0123456789".indexOf(initial) !== -1) {
		return parseNumber(raw, start);
	} else if (initial.match(/^[a-zA-Z_]/)) {
		return parseLabel(raw, start);
	}

	throw new Error("Address expected but found: " + raw.substring(start));
}

function parseArg(raw, start) {
	const len = raw.length;

	if (start >= len) {
		throw new Error("Argument expected but end of line found");
	}

	const initial = raw[start]

	if (initial === '$') {
		const [registerNumber, pos, source] = parseRegister(raw, start);
		return [new RegisterReference(registerNumber, source), pos, source];
	} else if ("-0123456789".indexOf(initial) !== -1) {
		const [number, pos, source] = parseNumber(raw, start);
		const numberLiteral = new NumberLiteral(number, source);

		if (raw.substring(pos).trim().startsWith('(')) {
			const [registerNumber, end, regSource] = parseRegisterInParentheses(raw, pos);
			const registerReference = new RegisterReference(registerNumber, regSource);
			const source = raw.substring(start, end)
			const memoryReference = new MemoryReference(numberLiteral, registerReference, source);
			return [memoryReference, end, source];
		}

		return [numberLiteral, pos, raw.substring(start, pos)];
	} else if (initial === '"' || initial === "'") {
		const [text, pos, source] = parseText(raw, start);
		if (text.length !== 1) {
			throw new Error("Text literal must be a single character: " + text);
		}
		return [new NumberLiteral(text.charCodeAt(0), source), pos, source];
	} else if (initial.match(/^[a-zA-Z_]/)) {
		const [label, pos, source] = parseLabel(raw, start);
		return [new LabelReference(label, source), pos, source];
	}

	throw new Error("Argument expected but found: " + raw.substring(start));
}

function parseArgs(raw) {
	let args = [];
	let pos = 0;
	let len = raw.length;

	let token = null;

	while (pos < len) {
		const [sep, sepEnd, sepSource] = parseSeparator(raw, pos, args.length > 0 ? '(,|(;.*))' : null);

		if (sepEnd >= len) {
			if (sep == ',') {
				args.push(null); // Will be handled elsewhere.
			}
			break;
		}

		const [arg, argEnd, argSource] = parseArg(raw, sepEnd);
		args.push(arg);

		pos = argEnd;
	}

	return args;
}

function RegisterReference(registerNumber) {
	this.concreteName = "a register";
	this.registerNumber = registerNumber;
	this.slug = '$' + registerNumber;

	this.read = function () {
		return REGISTERS[this.registerNumber];
	};

	this.write = function (value) {
		if (this.registerNumber === 0) {
			return;
		}
		REGISTERS[this.registerNumber] = value;
	};

	this.bits = function (fromAddress, bitCount, shift) {
		return this.registerNumber;
	};

	this.highlightAccess = function () {
		highlightRegisterAccess(this.registerNumber);
	};
}
RegisterReference.polymorphicName = "a register";


function Memory() {
	this.memory = {};

	this.read = function (address, expectCode) {
		const hexAddress = address.toString(16).padStart(8, '0');

		if (hexAddress === 'ffff0004') {
			if (STDIN_REMAINING.length === 0) {
				throw new Error("Ran out of standard input");
			}
			const char = STDIN_REMAINING[0];
			STDIN_REMAINING = STDIN_REMAINING.slice(1);
			return char.charCodeAt(0);
		} else if (hexAddress === 'ffff000c') {
			throw new Error("Cannot READ standard OUTPUT (it is write-only)!");
		}

		if (address % 4 !== 0) {
			throw new Error("Misaligned memory read: " + address + " = 0x" + hexAddress);
		}

		const content = this.memory[hexAddress];
		if (content) {
			if (expectCode) {
				if (typeof content == 'number') {
					throw new Error(`Attempted to read data at 0x${hexAddress} as code.\n\nNot advised for learning.`);
				} else {
					return content;
				}
			} else {
				if (typeof content == 'number') {
					return content;
				} else {
					throw new Error(`Attempted to read code at 0x${hexAddress} as data.\n\nNot advised for learning.`);
				}
			}
		} else {
			this.memory[hexAddress] = 0;
			return 0;
		}
	};

	this.write = function (address, value) {
		const hexAddress = address.toString(16).padStart(8, '0');

		if (hexAddress === 'ffff000c') {
			STDOUT += String.fromCharCode(value);
		} else if (hexAddress === 'ffff0004') {
			throw new Error("Cannot WRITE to standard INPUT (it is read-only)!");
		} else {

			if (address % 4 !== 0) {
				throw new Error("Misaligned memory write: " + address + " = 0x" + hexAddress);
			}
			this.memory[hexAddress] = value;

			let gutter =
				(value.toString(2).padStart(32, '0').match(/.{1,4}/g)?.join(' ') ?? '') +
				' | ' + describeValue(value);

			updateAddressGutter(address, gutter);
		}
	};
}

function MemoryReference(offset, registerReference, source) {
	this.concreteName = "a memory reference";
	this.offset = offset;
	this.registerReference = registerReference;
	this.source = source;
	this.slug = `MEM[${registerReference.slug} + ${offset.slug}]`

	this.read = function () {
		return MEMORY.read(offset.value + registerReference.read());
	};

	this.write = function (value) {
		MEMORY.write(offset.value + registerReference.read(), value);
	};

	this.bits = function (fromAddress, bitCount, shift) {
		return this.registerReference.bits(fromAddress, bitCount, shift);
	};

	this.highlightAccess = function () {
		this.registerReference.highlightAccess();
		highlightMemoryAccess(offset.value + registerReference.read());
	};
}
MemoryReference.polymorphicName = "a memory reference";

function NumberLiteral(value, source) {
	this.concreteName = "a number";
	this.value = value;

	this.source = source;
	this.slug = source ?? ('' + value);

	this.read = function () {
		return value;
	};

	this.readRelative = function (origin) {
		return origin + value;
	};

	this.bits = function (fromAddress, bitCount, shift) {
		if (this.value % (1 << shift) !== 0) {
			throw new Error("Label " + this.label + " is not aligned to " + (1 << shift) + " bytes");
		}
		// return two's complement representation if value is below 0
		return ((this.value >= 0) ? this.value : ((1 << bitCount) + this.value)) >> shift;
	};

	this.description = function (origin) {
		if (this.value >= 0) {
			return "0x" + origin.toString(16) + " + " + this.value.toString(16) + " = 0x" + (origin + this.value).toString(16);
		} else {
			return "0x" + origin.toString(16) + " - " + (-this.value).toString(16) + " = 0x" + (origin + this.value).toString(16);
		}
	};

	this.highlightAccess = function () {};
}
NumberLiteral.polymorphicName = "a number or a label";

function LabelReference(label, source) {
	this.concreteName = "a label";
	this.label = label;
	this.source = source;
	this.slug = source ?? ('' + value);

	this.read = function () {
		if (!(this.label in LABELS)) {
			throw new Error("Label " + this.label + " not found");
		}

		return LABELS[this.label];
	};

	this.readRelative = function (origin) {
		const result = this.read();
		const distance = result - origin;
		if (distance < -32768 || distance > 32767) {
			throw new Error("Label " + this.label + " is too far away from " + origin);
		}
		return result;
	};

	this.bits = function (fromAddress, bitCount, shift) {
		let x = LABELS[this.label] - fromAddress;
		if (x % (1 << shift) !== 0) {
			throw new Error("Label " + this.label + " is not aligned to " + (1 << shift) + " bytes");
		}

		// return two's complement representation if value is below 0
		return ((x >= 0) ? x : ((1 << bitCount) + x)) >> shift;
	};

	this.description = function (origin) {
		return this.label;
	};

	this.highlightAccess = function () {
		highlightMemoryAccess(this.read());
	};
}
LabelReference.polymorphicName = "a label";
LabelReference.prototype = Object.create(NumberLiteral.prototype);

function expectArgs(mnemonic, expectedArgs, providedArgs) {
	if (expectedArgs.length < providedArgs.length) {
		throw new Error(`${mnemonic} requires only ${expectedArgs.length} argument${expectedArgs.length > 1 ? 's' : ''}, you went too far with ${providedArgs.length}!`);
	}

	for (let i = 0; i < providedArgs.length; i++) {
		const expectedArg = expectedArgs[i];
		const providedArg = providedArgs[i];

		if (!providedArg) {
			throw new Error(`Argument ${expectedArg.slug} of '${mnemonic}' is missing: ${expectedArg.hint}`);
		}

		if (!(providedArgs[i] instanceof expectedArgs[i].kind)) {
			throw new Error(`Argument ${expectedArg.slug} of '${mnemonic}' is ${providedArg.concreteName} but should be ${expectedArg.kind.polymorphicName}: ${expectedArg.hint}`);
		}
	}

	if (expectedArgs.length > providedArgs.length) {
		const nextExpectedArg = expectedArgs[providedArgs.length];
		throw new Error(`Next: ${nextExpectedArg.slug}: ${nextExpectedArg.hint}`);
	}
}

function createInstruction(address, mnemonic, args) {
	switch (mnemonic) {
		case '.word':
			expectArgs(
				".word <i>",
				[
					{ kind: NumberLiteral, slug: "<i>", hint: "value for this memory location" }

				],
				args
			);
			return new DotWordInstruction(address, ...args);

		case 'add':
			expectArgs(
				"add $d, $s, $t",
				[
					{ kind: RegisterReference, slug: "$d", hint: "destination register for the sum" },
					{ kind: RegisterReference, slug: "$s", hint: "1st operand, augend" },
					{ kind: RegisterReference, slug: "$t", hint: "2nd operand, addend" }

				],
				args
			);
			return new AddInstruction(address, ...args);

		case 'sub':
			expectArgs(
				"sub $d, $s, $t",
				[
					{ kind: RegisterReference, slug: "$d", hint: "destination register for the difference" },
					{ kind: RegisterReference, slug: "$s", hint: "minuend, to subtract from" },
					{ kind: RegisterReference, slug: "$t", hint: "subtrahend to subtract from minuend" }

				],
				args
			);
			return new SubInstruction(address, ...args);

		case 'mult':
			expectArgs(
				"mult $s, $t",
				[
					{ kind: RegisterReference, slug: "$s", hint: "multiplicand to multiply" },
					{ kind: RegisterReference, slug: "$t", hint: "multiplier to multiply by" }

				],
				args
			);
			return new MultInstruction(address, ...args);

		case 'multu':
			expectArgs(
				"multu $s, $t",
				[
					{ kind: RegisterReference, slug: "$s", hint: "multiplicand to multiply" },
					{ kind: RegisterReference, slug: "$t", hint: "multiplier to multiply by" }

				],
				args
			);
			return new MultuInstruction(address, ...args);

		case 'div':
			expectArgs(
				"div $s, $t",
				[
					{ kind: RegisterReference, slug: "$s", hint: "dividend to divide" },
					{ kind: RegisterReference, slug: "$t", hint: "divisor to divide by" }

				],
				args
			);
			return new DivInstruction(address, ...args);

		case 'divu':
			expectArgs(
				"divu $s, $t",
				[
					{ kind: RegisterReference, slug: "$s", hint: "dividend to divide" },
					{ kind: RegisterReference, slug: "$t", hint: "divisor to divide by" }

				],
				args
			);
			return new DivuInstruction(address, ...args);

		case 'mfhi':
			expectArgs(
				"mfhi $d",
				[
					{ kind: RegisterReference, slug: "$d", hint: "destination register for hi/remainder of mult/multu/div/divu" }

				],
				args
			);
			return new MfhiInstruction(address, ...args);

		case 'mflo':
			expectArgs(
				"mflo $d",
				[
					{ kind: RegisterReference, slug: "$d", hint: "destination register for lo/quotient of mult/multu/div/divu" }

				],
				args
			);
			return new MfloInstruction(address, ...args);

		case 'lis':
			expectArgs(
				"lis $d",
				[
					{ kind: RegisterReference, slug: "$d", hint: "register to load the next word into" }

				],
				args
			);
			return new LisInstruction(address, ...args);

		case 'lw':
			expectArgs(
				"lw $t, <i>($s)",
				[
					{ kind: RegisterReference, slug: "$t", hint: "target register to load memory content into" },
					{ kind: MemoryReference, slug: "$s", hint: "source <offset>($register) memory reference" }

				],
				args
			);
			return new LwInstruction(address, ...args);

		case 'sw':
			expectArgs(
				"sw $t, <i>($s)",
				[
					{ kind: RegisterReference, slug: "$t", hint: "target register to store into memory" },
					{ kind: MemoryReference, slug: "$s", hint: "destination <offset>($register) memory reference" }

				],
				args
			);
			return new SwInstruction(address, ...args);

		case 'slt':
			expectArgs(
				"slt $d, $s, $t",
				[
					{ kind: RegisterReference, slug: "$d", hint: "register to store $s < $t comparison result into (0 or 1)" },
					{ kind: RegisterReference, slug: "$s", hint: "register to check if less than $t" },
					{ kind: RegisterReference, slug: "$t", hint: "register to check if $s is less than" }

				],
				args
			);
			return new SltInstruction(address, ...args);

		case 'sltu':
			expectArgs(
				"sltu $d, $s, $t",
				[
					{ kind: RegisterReference, slug: "$d", hint: "register to store $s < $t comparison result into (0 or 1)" },
					{ kind: RegisterReference, slug: "$s", hint: "register to check if less than $t" },
					{ kind: RegisterReference, slug: "$t", hint: "register to check if $s is less than" }

				],
				args
			);
			return new SltuInstruction(address, ...args);

		case 'beq':
			expectArgs(
				"beq $s, $t, <i>",
				[
					{ kind: RegisterReference, slug: "$s", hint: "register to compare with $t" },
					{ kind: RegisterReference, slug: "$t", hint: "register to compare $s with" },
					{ kind: NumberLiteral, slug: "<i>", hint: "address to go to if $s=$t (label or relative to $pc+4)" }

				],
				args
			);
			return new BeqInstruction(address, ...args);

		case 'bne':
			expectArgs(
				"bne $s, $t, <i>",
				[
					{ kind: RegisterReference, slug: "$s", hint: "register to compare with $t" },
					{ kind: RegisterReference, slug: "$t", hint: "register to compare $s with" },
					{ kind: NumberLiteral, slug: "<i>", hint: "address to go to if $s\u2260$t (label or relative to $pc+4)" }

				],
				args
			);
			return new BneInstruction(address, ...args);

		case 'jr':
			expectArgs(
				"jr $s",
				[
					{ kind: RegisterReference, slug: "$s", hint: "register with address to continue from" }

				],
				args
			);
			return new JrInstruction(address, ...args);

		case 'jalr':
			expectArgs(
				"jalr $s",
				[
					{ kind: RegisterReference, slug: "$s", hint: "register with address to continue from" }

				],
				args
			);
			return new JalrInstruction(address, ...args);

		case 'addi':
			expectArgs(
				"addi $t, $s, <i>",
				[
					{ kind: RegisterReference, slug: "$t", hint: "destination register for the sum" },
					{ kind: RegisterReference, slug: "$s", hint: "1st operand, augend" },
					{ kind: NumberLiteral, slug: "<i>", hint: "2nd operand, addend (immediate or label)" }

				],
				args
			);
			return new AddiInstruction(address, ...args);

		case 'j':
			expectArgs(
				"j <i>",
				[
					{ kind: NumberLiteral, slug: "<i>", hint: "address to continue from" }

				],
				args
			);
			return new JInstruction(address, ...args);

		case 'jal':
			expectArgs(
				"jal <i>",
				[
					{ kind: NumberLiteral, slug: "<i>", hint: "address to continue from" }

				],
				args
			);
			return new JalInstruction(address, ...args);

		default:
			throw new Error("Unknown mnemonic: " + mnemonic);
	}
}

function makeOpcode(address, pattern, params) {
	let opcode = pattern.replace(/ /g, '');
	for (key in params) {
		if (key.length !== 1) continue;

		let param = params[key];

		const pattern = new RegExp('[' + key.toUpperCase() + key.toLowerCase() + "]+", 'g');
		const match = pattern.exec(opcode);
		if (match) {
			const pos = match.index;
			const pat = match[0];
			const len = pat.length;

			const shift = pat === pat.toUpperCase() ? 2 : 0;
			const value = param.bits(address, len + shift, shift);

			const replacement = value.toString(2).padStart(len, '0');
			opcode = opcode.slice(0, pos) + replacement + opcode.slice(pos + len);
		}
	}
	return opcode.match(/.{1,4}/g)?.join(' ') ?? '';
}

function describeValue(value) {
	let unsignedValue = unsigned(value);

	let dec_signed = value.toString(10).padStart(11, ' ');
	let dec_unsigned = unsignedValue.toString(10).padStart(10, ' ');
	let hex = '0x' + unsignedValue.toString(16).padStart(8, '.');

	let char;
	if (value == 9) {
		char = 'TAB';
	} else if (value == 10) {
		char = 'LF ';
	} else if (value == 13) {
		char = 'CR ';
	} else if (value == 0) {
		char = 'NUL';
	} else if (unsignedValue > 0 && unsignedValue < 65536) {
		char = String.fromCharCode(unsignedValue);
		if (char.match(/\p{Letter}|\p{Number}|\p{Punctuation}|\p{Symbol}/u)) {
			// char = "'\u202D" + char + "'";
			if (char.match(/\u0591-\u07FF\u200F\u202B\u202E\uFB1D-\uFDFD\uFE70-\uFEFC/u)) {
				char = "RTL";
			} else {
				char = "'" + char + "'";
			}
		} else {
			char = "???";
		}
	} else {
		char = "   "
	}

	return hex + " = " + char + " = " + dec_signed + " = " + dec_unsigned;
}

function DotWordInstruction(address, i) {
	this.i = i;

	if (i instanceof LabelReference) {
		this.description = 'Address of ' + i.label;
		this.opcode = labelBits(address, i, 39);
	} else {
		let value = i.read();
		MEMORY.write(address, value);
		this.description = describeValue(value);
		this.opcode = makeOpcode(address, 'iiii iiii iiii iiii iiii iiii iiii iiii', this);
	}

	this.address = address;

	this.link = function () {
		if (this.i instanceof LabelReference) {
			let value;
			try {
				value = this.i.read();
				MEMORY.write(this.address, value);
				this.description = 'Address of ' + this.i.label;
				this.opcode = makeOpcode(this.address, 'iiii iiii iiii iiii iiii iiii iiii iiii', this);
				updateAddressGutter(this.address, this.opcode + " | 0x" + value.toString(16).padStart(8, '.') + " = address of " + this.i.label);
			} catch (e) {
				this.description = 'Address of ' + this.i.label;
				this.opcode = labelBits(this.address, this.i, 39);
			}
		}
	};

	this.execute = function () {
		throw new Error(".word possibly could but SHOULD NOT be executed");
	};

	this.highlightOperands = function () {};
}

function AddInstruction(address, d, s, t) {
	this.d = d;
	this.s = s;
	this.t = t;

	this.description = `\$${d.registerNumber} \u27f5 \$${s.registerNumber} + \$${t.registerNumber}`;

	this.opcode = makeOpcode(address, '0000 00ss ssst tttt dddd d000 0010 0000', this);

	this.address = address;

	this.link = function () { };

	this.execute = function () {
		this.d.write((this.s.read() + this.t.read()) & 0xFFFFFFFF);
		REGISTERS[34] = (address + 4) & 0xFFFFFFFF;
	};

	this.highlightOperands = function () {
		this.d.highlightAccess();
		this.s.highlightAccess();
		this.t.highlightAccess();
	};
}

function SubInstruction(address, d, s, t) {
	this.d = d;
	this.s = s;
	this.t = t;

	this.description = `\$${d.registerNumber} \u27f5 \$${s.registerNumber} - \$${t.registerNumber}`;

	this.opcode = makeOpcode(address, '0000 00ss ssst tttt dddd d000 0010 0010', this);

	this.address = address;

	this.link = function () { };

	this.execute = function () {
		this.d.write((this.s.read() - this.t.read()) & 0xFFFFFFFF);
		REGISTERS[34] = (address + 4) & 0xFFFFFFFF;
	};

	this.highlightOperands = function () {
		this.d.highlightAccess();
		this.s.highlightAccess();
		this.t.highlightAccess();
	};
}

function MultInstruction(address, s, t) {
	this.s = s;
	this.t = t;

	this.description = `$hi:$lo \u27f5 \$${s.registerNumber} * \$${t.registerNumber}`;

	this.opcode = makeOpcode(address, '0000 00ss ssst tttt 0000 0000 0001 1000', this);

	this.address = address;

	this.link = function () { };

	this.execute = function () {
		// multiply s and t as BigInt
		const result = BigInt(this.s.read()) * BigInt(this.t.read());
		REGISTERS[32] = (result >> BigInt(32)) & BigInt(0xFFFFFFFF);
		REGISTERS[33] = result & BigInt(0xFFFFFFFF);
		REGISTERS[34] = (address + 4) & 0xFFFFFFFF;
	};

	this.highlightOperands = function () {
		this.s.highlightAccess();
		this.t.highlightAccess();
		highlightRegisterAccess(32);
		highlightRegisterAccess(33);
	};
}

function unsigned(value) {
	// if the value is negative then remove the two's complement
	return (value >= 0) ? value : (4294967296 + value);
}

function unsignedBig(value) {
	b = BigInt(value);
	return (value >= 0) ? b : (BigInt(4294967296) + b);
}

function signed(value) {
	return (value >= 0x80000000) ? Number(value - 0x100000000) : Number(value);
}

function MultuInstruction(address, s, t) {
	this.s = s;
	this.t = t;

	this.description = `$hi:$lo \u27f5 \$${s.registerNumber} * \$${t.registerNumber} (unsigned)`;

	this.opcode = makeOpcode(address, '0000 00ss ssst tttt 0000 0000 0001 1001', this);

	this.address = address;

	this.link = function () { };

	this.execute = function () {
		const result = unsignedBig(this.s.read()) * unsignedBig(this.t.read());
		REGISTERS[32] = signed((result >> BigInt(32)) & BigInt(0xFFFFFFFF));
		REGISTERS[33] = signed(result & BigInt(0xFFFFFFFF));
		REGISTERS[34] = (address + 4) & 0xFFFFFFFF;
	};

	this.highlightOperands = function () {
		this.s.highlightAccess();
		this.t.highlightAccess();
		highlightRegisterAccess(32);
		highlightRegisterAccess(33);
	};
}

function DivInstruction(address, s, t) {
	this.s = s;
	this.t = t;

	this.description = `$lo \u27f5 \$${s.registerNumber} / \$${t.registerNumber}, $hi \u27f5 \$${s.registerNumber} mod \$${t.registerNumber}`;

	this.opcode = makeOpcode(address, '0000 00ss ssst tttt 0000 0000 0001 1010', this);

	this.address = address;

	this.link = function () { };

	this.execute = function () {
		this.execute = function () {
			const dividend = BigInt(this.s.read());
			const divisor = BigInt(this.t.read());

			REGISTERS[32] = signed(dividend % divisor);
			REGISTERS[33] = signed(dividend / divisor);
			REGISTERS[34] = (address + 4) & 0xFFFFFFFF;
		}
	};

	this.highlightOperands = function () {
		this.s.highlightAccess();
		this.t.highlightAccess();
		highlightRegisterAccess(32);
		highlightRegisterAccess(33);
	};
}

function DivuInstruction(address, s, t) {
	this.s = s;
	this.t = t;

	this.description = `$lo \u27f5 \$${s.registerNumber} / \$${t.registerNumber}, $hi \u27f5 \$${s.registerNumber} mod \$${t.registerNumber} (unsigned)`;

	this.opcode = makeOpcode(address, '0000 00ss ssst tttt 0000 0000 0001 1011', this);

	this.address = address;

	this.link = function () { };

	this.execute = function () {
		const dividend = unsignedBig(this.s.read());
		const divisor = unsignedBig(this.t.read());

		REGISTERS[32] = signed(dividend % divisor);
		REGISTERS[33] = signed(dividend / divisor);
		REGISTERS[34] = (address + 4) & 0xFFFFFFFF;
	};

	this.highlightOperands = function () {
		this.s.highlightAccess();
		this.t.highlightAccess();
		highlightRegisterAccess(32);
		highlightRegisterAccess(33);
	};
}

function MfhiInstruction(address, d) {
	this.d = d;

	this.description = `\$${d.registerNumber} \u27f5 hi/remainder`;

	this.opcode = makeOpcode(address, '0000 0000 0000 0000 dddd d000 0001 0000', this);

	this.address = address;

	this.link = function () { };

	this.execute = function () {
		this.d.write(REGISTERS[32]);
		REGISTERS[34] = (address + 4) & 0xFFFFFFFF;
	};

	this.highlightOperands = function () {
		this.d.highlightAccess();
		highlightRegisterAccess(32);
		highlightRegisterAccess(33);
	};
}

function MfloInstruction(address, d) {
	this.d = d;

	this.description = `\$${d.registerNumber} \u27f5 lo/quotient`;

	this.opcode = makeOpcode(address, '0000 0000 0000 0000 dddd d000 0001 0010', this);

	this.address = address;

	this.link = function () { };

	this.execute = function () {
		this.d.write(REGISTERS[31]);
		REGISTERS[34] = (address + 4) & 0xFFFFFFFF;
	};

	this.highlightOperands = function () {
		this.d.highlightAccess();
		highlightRegisterAccess(33);
	};
}

function LisInstruction(address, d) {
	this.d = d;

	this.description = `\$${d.registerNumber} \u27f5 MEM[0x${(address + 4).toString(16)}]`;

	this.opcode = makeOpcode(address, '0000 0000 0000 0000 dddd d000 0001 0100', this);

	this.address = address;

	this.link = function () { };

	this.execute = function () {
		this.d.write(MEMORY.read(address + 4));
		REGISTERS[34] = address + 8;
	};

	this.highlightOperands = function () {
		this.d.highlightAccess();
		highlightMemoryAccess(address + 4);
	};
}

function LwInstruction(address, t, s) {
	this.t = t;
	this.s = s;
	this.i = s.offset;

	this.description = `\$${t.registerNumber} \u27f5 MEM[\$${s.registerReference.registerNumber} + ${s.offset.value}]`;

	this.opcode = makeOpcode(address, '1000 11ss ssst tttt iiii iiii iiii iiii', this);

	this.address = address;

	this.link = function () { };

	this.execute = function () {
		this.t.write(this.s.read());
		REGISTERS[34] = (address + 4) & 0xFFFFFFFF;
	};

	this.highlightOperands = function () {
		this.t.highlightAccess();
		this.s.highlightAccess();
	};
}

function SwInstruction(address, t, s) {
	this.t = t;
	this.s = s;
	this.i = s.offset;

	this.description = `MEM[\$${s.registerReference.registerNumber} + ${s.offset.value}] \u27f5 \$${t.registerNumber}`;

	this.opcode = makeOpcode(address, '1010 11ss ssst tttt iiii iiii iiii iiii', this);

	this.address = address;

	this.link = function () { };

	this.execute = function () {
		this.s.write(this.t.read());
		REGISTERS[34] = (address + 4) & 0xFFFFFFFF;
	};

	this.highlightOperands = function () {
		this.t.highlightAccess();
		this.s.highlightAccess();
	};
}

function SltInstruction(address, d, s, t) {
	this.d = d;
	this.s = s;
	this.t = t;

	this.description = `\$${d.registerNumber} \u27f5 1 if \$${s.registerNumber} < \$${t.registerNumber}, 0 otherwise`;

	this.opcode = makeOpcode(address, '0000 00ss ssst tttt dddd d000 0010 1010', this);

	this.address = address;

	this.link = function () { };

	this.execute = function () {
		this.d.write((this.s.read() < this.t.read()) ? 1 : 0);
		REGISTERS[34] = (address + 4) & 0xFFFFFFFF;
	};

	this.highlightOperands = function () {
		this.d.highlightAccess();
		this.s.highlightAccess();
		this.t.highlightAccess();
	};

}

function SltuInstruction(address, d, s, t) {
	this.d = d;
	this.s = s;
	this.t = t;

	this.description = `\$${d.registerNumber} \u27f5 1 if \$${s.registerNumber} < \$${t.registerNumber} (unsigned), 0 otherwise`;

	this.opcode = makeOpcode(address, '0000 00ss ssst tttt dddd d000 0010 1011', this);

	this.address = address;

	this.link = function () { };

	this.execute = function () {
		this.d.write((unsignedBig(this.s.read()) < unsignedBig(this.t.read())) ? 1 : 0);
		REGISTERS[34] = (address + 4) & 0xFFFFFFFF;
	};

	this.highlightOperands = function () {
		this.d.highlightAccess();
		this.s.highlightAccess();
		this.t.highlightAccess();
	};
}


function labelBits(address, labelRef, maxLength) {
	const label = labelRef.label;
	let padTotal = maxLength - 2 - label.length;

	let padded;
	if (padTotal < 0) {
		padded = ref.slice(0, maxLength);
		if (padded.length < maxLength) {
			padded = '.';
		}
	} else {
		let padLeft = Math.floor(padTotal / 2);
		let padRight = padTotal - padLeft;

		padded = '<' + '.'.repeat(padLeft) + label + '.'.repeat(padRight) + '>';
	}

	return padded;
}


function BeqInstruction(address, s, t, i) {
	this.s = s;
	this.t = t;
	this.i = i;

	if (i instanceof LabelReference) {
		this.description = `if (\$${s.registerNumber} = \$${t.registerNumber}) go to ${i.description(address + 4)}`;
		this.opcode = makeOpcode(address, '0001 00ss ssst tttt ', this) + labelBits(address, i, 20);
	} else if (i instanceof NumberLiteral) {
		this.description = `if (\$${s.registerNumber} = \$${t.registerNumber}) go to ${i.description(address + 4)}`;
		this.opcode = makeOpcode(address, '0001 00ss ssst tttt IIII IIII IIII IIII', this);
	} else {
		this.description = `if (\$${s.registerNumber} = \$${t.registerNumber}) go to somewhere`;
		this.opcode = makeOpcode(address, '0001 00ss ssst tttt ???? ???? ???? ????', this);
	}

	this.address = address;

	this.link = function () {
		if (this.i instanceof LabelReference) {
			this.description = `if (\$${s.registerNumber} = \$${t.registerNumber}) go to ${i.description(address + 4)}`;
			this.opcode = makeOpcode(address, '0001 00ss ssst tttt IIII IIII IIII IIII', this);
			updateAddressGutter(this.address, this.opcode + " | " + this.description);
		}
	};

	this.execute = function () {
		if (this.s.read() === this.t.read()) {
			REGISTERS[34] = this.i.readRelative(address + 4);
		} else {
			REGISTERS[34] = (address + 4) & 0xFFFFFFFF;
		}
	};

	this.highlightOperands = function () {
		highlightMemoryAccess(this.i.readRelative(address + 4));
		this.s.highlightAccess();
		this.t.highlightAccess();
	};
}

function BneInstruction(address, s, t, i) {
	this.s = s;
	this.t = t;
	this.i = i;

	if (i instanceof LabelReference) {
		this.description = `if (\$${s.registerNumber} \u2260 \$${t.registerNumber}) go to ${i.description(address + 4)}`;
		this.opcode = makeOpcode(address, '0001 01ss ssst tttt ', this) + labelBits(address, i, 20);
	} else if (i instanceof NumberLiteral) {
		this.description = `if (\$${s.registerNumber} \u2260 \$${t.registerNumber}) go to ${i.description(address + 4)}`;
		this.opcode = makeOpcode(address, '0001 01ss ssst tttt IIII IIII IIII IIII', this);
	} else {
		this.description = `if (\$${s.registerNumber} \u2260 \$${t.registerNumber}) go to somwhere`;
		this.opcode = makeOpcode(address, '0001 01ss ssst tttt ???? ???? ???? ????', this);
	}

	this.address = address;

	this.link = function () {
		if (this.i instanceof LabelReference) {
			this.description = `if (\$${s.registerNumber} \u2260 \$${t.registerNumber}) go to ${i.description(address + 4)}`;
			this.opcode = makeOpcode(address, '0001 01ss ssst tttt IIII IIII IIII IIII', this);
			updateAddressGutter(this.address, this.opcode + " | " + this.description);
		}
	};

	this.execute = function () {
		if (this.s.read() !== this.t.read()) {
			REGISTERS[34] = this.i.readRelative(address + 4);
		} else {
			REGISTERS[34] = (address + 4) & 0xFFFFFFFF;
		}
	};

	this.highlightOperands = function () {
		highlightMemoryAccess(this.i.readRelative(address + 4));
		this.s.highlightAccess();
		this.t.highlightAccess();
	};
}

function JrInstruction(address, s) {
	this.s = s;

	this.description = `go to \$${s.registerNumber}`;

	this.opcode = makeOpcode(address, '0000 00ss sss0 0000 0000 0000 0000 1000', this);

	this.address = address;

	this.link = function () { };

	this.execute = function () {
		REGISTERS[34] = this.s.read();
	};

	this.highlightOperands = function () {
		highlightMemoryAccess(this.s.read());
		this.s.highlightAccess();
	};
}

function JalrInstruction(address, s) {
	this.s = s;
	this.description = `$31 \u27f5 0x${(address + 4).toString(16)}, go to $${s.registerNumber}`;

	this.opcode = makeOpcode(address, '0000 00ss sss0 0000 0000 0000 0000 1001', this);

	this.address = address;

	this.link = function () { };

	this.execute = function () {
		REGISTERS[31] = address + 4;
		REGISTERS[34] = this.s.read();
	};

	this.highlightOperands = function () {
		highlightMemoryAccess(this.s.read());
		highlightRegisterAccess(31);
		this.s.highlightAccess();
	};
}

function AddiInstruction(address, t, s, i) {
	this.t = t;
	this.s = s;
	this.i = i;

	this.description = `\$${t.registerNumber} \u27f5 \$${s.registerNumber} + ${i.read()}`;

	this.opcode = makeOpcode(address, '0010 00ss ssst tttt iiii iiii iiii iiii', this);

	this.address = address;

	this.link = function () { };

	this.execute = function () {
		this.t.write((this.s.read() + this.i.read()) & 0xFFFFFFFF);
		REGISTERS[34] = (address + 4) & 0xFFFFFFFF;
	};

	this.highlightOperands = function () {
		this.s.highlightAccess();
		this.t.highlightAccess();
	};
}

function JInstruction(address, i) {
	this.i = i;

	this.description = `go to ${i.description(address + 4)}`;

	if (i instanceof LabelReference) {
		this.opcode = '0000 10' + labelBits(address, i, 32);
	} else if (i instanceof NumberLiteral) {
		this.opcode = makeOpcode(address, '0000 10II IIII IIII IIII IIII IIII IIII', this);
	} else {
		this.opcode = makeOpcode(address, '0000 10?? ???? ???? ???? ???? ???? ????', this);
	}

	this.address = address;

	this.link = function () {
		if (this.i instanceof LabelReference) {
			this.description = `go to ${this.i.description(address + 4)}`;
			this.opcode = makeOpcode(address, '0000 10II IIII IIII IIII IIII IIII IIII', this);
			updateAddressGutter(this.address, this.opcode + " | " + this.description);
		}
	};

	this.execute = function () {
		REGISTERS[34] = (address & 0xF0000000) | this.i.read();
	};

	this.highlightOperands = function () {
		highlightMemoryAccess((address & 0xF0000000) | this.i.read());
	};
}

function JalInstruction(address, i) {
	this.i = i;

	if (i instanceof LabelReference) {
		this.description = `$31 \u27f5 0x${(address + 4).toString(16)} & go to ${i.label}`;
		this.opcode = '0000 11' + labelBits(address, i, 32);
	} else if (i instanceof NumberLiteral) {
		this.description = `$31 \u27f5 0x${(address + 4).toString(16)} & go to ${i.description(address + 4)}`;
		this.opcode = makeOpcode(address, '0000 11II IIII IIII IIII IIII IIII IIII', this);
	} else {
		this.opcode = makeOpcode(address, '0000 11?? ???? ???? ???? ???? ???? ????', this);
	}

	this.address = address;

	this.link = function () {
		if (this.i instanceof LabelReference) {
			this.description = `$31 \u27f5 0x${(address + 4).toString(16)} & go to ${i.description(address + 4)}`;
			this.opcode = makeOpcode(address, '0000 11II IIII IIII IIII IIII IIII IIII', this);
			updateAddressGutter(this.address, this.opcode + " | " + this.description);
		}
	};

	this.execute = function () {
		REGISTERS[31] = address + 4;
		REGISTERS[34] = (address & 0xF0000000) | this.i.read();
	};

	this.highlightOperands = function () {
		highlightMemoryAccess((address & 0xF0000000) | this.i.read());
		highlightRegisterAccess(31);
	};
}

function AssertInstruction(address, a, operator, b, source) {
	this.address = address;
	this.a = a;
	this.operator = operator;
	this.b = b;
	this.source = source;

	this.opcode = '---- ---- ---- ---- ---- ---- ---- ----';
	this.description = `warn if not: ${a.slug} ${operator} ${b.slug}`

	this.link = function () { }

	this.execute = function () {
		const aValue = a.read();
		const bValue = b.read();

		let good = false;
		switch (this.operator) {
			case '<':  good = aValue   <  bValue; break;
			case '<=': good = aValue   <= bValue; break;
			case '==': good = aValue  === bValue; break;
			case '>=': good = aValue   >= bValue; break;
			case '>':  good = aValue   >  bValue; break;
			case '!=': good = aValue  !== bValue; break;
			default:
				alert("Internal troubleship. Operator unexpectation: " + this.operator);
				good = true; // No point showing another error.
				break;
		}
		if (!good) {
			good = confirm(`Assertion failed! Continue?\n\n${this.source}\n\n${this.a.slug} = ${aValue}\n${this.b.slug} = ${bValue}\n\n${aValue} is NOT ${this.operator} ${bValue}`);
		}
		if (good) {
			REGISTERS[34] = (address + 4) & 0xFFFFFFFF;
		}
	};

	this.highlightOperands = function () {
		this.a.highlightAccess();
		this.b.highlightAccess();
	};
}

function getCurrentInstruction() {
	let pc = getPC();
	const instruction = MEMORY.read(pc, true);

	if (!instruction) {
		throw new Error("Cannot run generated code at 0x" + REGISTERS[34].toString(16) + ". Dynamically generated code is not supported yet.");
	}

	return instruction;
}
