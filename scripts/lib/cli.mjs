/**
 * Parses long options and rejects unknown, duplicate, missing, and positional
 * arguments. Values may use either `--name=value` or `--name value`.
 */
export function parseLongOptions(argv, specification, commandName) {
  const result = Object.create(null);
  const entries = new Map(Object.entries(specification));

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (typeof argument !== "string" || !argument.startsWith("--")) {
      throw new Error(`${commandName}: unsupported positional argument ${String(argument)}`);
    }
    const separator = argument.indexOf("=");
    const name = argument.slice(2, separator < 0 ? undefined : separator);
    const option = entries.get(name);
    if (option === undefined) throw new Error(`${commandName}: unsupported option --${name}`);
    if (Object.hasOwn(result, name)) throw new Error(`${commandName}: duplicate option --${name}`);

    if (option.type === "boolean") {
      if (separator >= 0) throw new Error(`${commandName}: --${name} does not accept a value`);
      result[name] = true;
      continue;
    }

    const inlineValue = separator < 0 ? undefined : argument.slice(separator + 1);
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      throw new Error(`${commandName}: --${name} requires a value`);
    }
    result[name] = value;
  }

  for (const [name, option] of entries) {
    if (option.required === true && !Object.hasOwn(result, name)) {
      throw new Error(`${commandName}: missing required option --${name}`);
    }
    if (!Object.hasOwn(result, name) && Object.hasOwn(option, "default")) {
      result[name] = option.default;
    }
  }
  return Object.freeze(result);
}
