TARGET := riscv64-unknown-linux-gnu
CC := $(TARGET)-gcc
LD := $(TARGET)-gcc
OBJCOPY := $(TARGET)-objcopy
CFLAGS := -fPIC -O3 -nostdinc -nostdlib -nostartfiles -fvisibility=hidden -I deps/secp256k1/src -I deps/secp256k1 -I deps/ckb-c-stdlib -I deps/ckb-c-stdlib/libc -I deps/molecule -I c -I build -Wall -Werror -Wno-nonnull -Wno-nonnull-compare -Wno-unused-function -g
LDFLAGS := -Wl,-static -fdata-sections -ffunction-sections -Wl,--gc-sections

# docker pull nervos/ckb-riscv-gnu-toolchain:gnu-jammy-20230214
BUILDER_DOCKER := nervos/ckb-riscv-gnu-toolchain@sha256:d3f649ca711293c4c235594fd9ec20337eecf4aabf9e23c8c8301ca24dbebce8

all: build/always-success

build/always-success: src/main.rs
	cargo build --release --target=riscv64imac-unknown-none-elf
	mkdir -p build
	cp target/riscv64imac-unknown-none-elf/release/always-success build/always-success
	ckb-binary-patcher -i build/always-success -o build/always-success

clean:
	cargo clean
	rm -rf build

.PHONY: all clean
