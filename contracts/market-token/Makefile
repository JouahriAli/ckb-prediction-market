# Makefile for building CKB contract

TARGET := riscv64imac-unknown-none-elf
CONTRACT_NAME := market-token
BUILD_DIR := build

.PHONY: all clean build check

all: build

# Install RISC-V target if not already installed
install-target:
	@rustup target add $(TARGET)

# Build the contract
build: install-target
	@echo "Building $(CONTRACT_NAME)..."
	@cargo build --release --target $(TARGET)
	@mkdir -p $(BUILD_DIR)
	@cp target/$(TARGET)/release/$(CONTRACT_NAME) $(BUILD_DIR)/$(CONTRACT_NAME)
	@ckb-binary-patcher -i $(BUILD_DIR)/$(CONTRACT_NAME) -o $(BUILD_DIR)/$(CONTRACT_NAME).patched 2>/dev/null || cp $(BUILD_DIR)/$(CONTRACT_NAME) $(BUILD_DIR)/$(CONTRACT_NAME).patched
	@echo "Contract built successfully!"
	@echo "Binary location: $(BUILD_DIR)/$(CONTRACT_NAME).patched"
	@ls -lh $(BUILD_DIR)/

# Run cargo check
check:
	@cargo check --target $(TARGET)

# Clean build artifacts
clean:
	@cargo clean
	@rm -rf $(BUILD_DIR)
	@echo "Clean complete"

# Show contract size
size: build
	@echo "\nContract size:"
	@ls -lh $(BUILD_DIR)/$(CONTRACT_NAME).patched | awk '{print $$5 " " $$9}'
