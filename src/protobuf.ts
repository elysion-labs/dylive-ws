interface Field {
  wireType: number;
  value: bigint | Uint8Array;
}

const textDecoder = new TextDecoder('utf-8', { fatal: true });

export class ProtoMessage {
  private offset = 0;
  private readonly fields = new Map<number, Field[]>();

  constructor(
    private readonly data: Uint8Array,
    wanted: readonly number[],
  ) {
    while (this.offset < data.length) {
      const tag = this.varint();
      const field = Number(tag >> 3n);
      const wireType = Number(tag & 7n);

      if (field < 1 || field > 0x1fff_ffff) {
        throw new Error('Invalid protobuf field number');
      }

      const value = wireType === 0 ? this.varint() : this.bytes(wireType);

      if (!wanted.includes(field)) {
        continue;
      }

      const values = this.fields.get(field);

      if (values) {
        values.push({ wireType, value });
      } else {
        this.fields.set(field, [{ wireType, value }]);
      }
    }
  }

  uint64(field: number): string | undefined {
    const value = this.fields.get(field)?.at(-1);

    if (!value) {
      return undefined;
    }

    if (value.wireType !== 0) {
      throw new Error(`Expected a protobuf varint in field ${field}`);
    }

    return value.value.toString();
  }

  string(field: number): string | undefined {
    const value = this.dataField(field);

    return value && textDecoder.decode(value);
  }

  dataField(field: number): Uint8Array | undefined {
    const value = this.fields.get(field)?.at(-1);

    return value && this.expectBytes(value, field);
  }

  repeatedBytes(field: number): Uint8Array[] {
    return (this.fields.get(field) ?? []).map(value => this.expectBytes(value, field));
  }

  private expectBytes(field: Field, number: number): Uint8Array {
    if (field.wireType !== 2 || typeof field.value === 'bigint') {
      throw new Error(`Expected protobuf bytes in field ${number}`);
    }

    return field.value;
  }

  private varint(): bigint {
    let result = 0n;

    for (let index = 0; index < 10; index++) {
      const byte = this.data[this.offset++];

      if (byte === undefined || (index === 9 && byte > 1)) {
        throw new Error('Invalid protobuf uint64 varint');
      }

      result |= BigInt(byte & 0x7f) << BigInt(index * 7);

      if (byte < 0x80) {
        return result;
      }
    }

    throw new Error('Invalid protobuf uint64 varint');
  }

  private bytes(wireType: number): Uint8Array {
    let length: number;

    switch (wireType) {
      case 1: {
        length = 8;
        break;
      }

      case 2: {
        length = Number(this.varint());
        break;
      }

      case 5: {
        length = 4;
        break;
      }

      default: {
        throw new Error(`Unsupported protobuf wire type ${wireType}`);
      }
    }

    if (length > this.data.length - this.offset) {
      throw new Error('Truncated protobuf field');
    }

    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;

    return value;
  }
}
