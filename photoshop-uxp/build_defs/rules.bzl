def _tree(ctx):
    entries = dict(ctx.attrs.srcs)
    for name, dep in ctx.attrs.subdirs.items():
        entries[name] = dep[DefaultInfo].default_outputs[0]
    return [DefaultInfo(default_output = ctx.actions.copied_dir("sources", entries))]

source_tree = rule(impl = _tree, attrs = {"srcs": attrs.dict(attrs.string(), attrs.source()),
    "subdirs": attrs.dict(attrs.string(), attrs.dep(), default = {})})

def _bootstrap(ctx):
    return [DefaultInfo(), RunInfo(args = cmd_args("python3", ctx.attrs.script, "--node", ctx.attrs.node[RunInfo]))]

bootstrap = rule(impl = _bootstrap, attrs = {"script": attrs.source(), "node": attrs.exec_dep(default = "root//:node")})

def _node(ctx):
    archive = ctx.actions.download_file("node.tar.xz", ctx.attrs.url, sha256 = ctx.attrs.sha256)
    output = ctx.actions.declare_output("node", dir = True)
    ctx.actions.run(cmd_args("python3", ctx.attrs.unpack, archive, output.as_output()), category = "node_toolchain")
    return [DefaultInfo(default_output = output), RunInfo(args = [output.project("bin/node")])]

node_tool = rule(impl = _node, attrs = {"url": attrs.string(), "sha256": attrs.string(), "unpack": attrs.source()})

def _node_program(ctx):
    return [DefaultInfo(), RunInfo(args = cmd_args(ctx.attrs.node[RunInfo], ctx.attrs.script,
        "--plugin", ctx.attrs.plugin[DefaultInfo].default_outputs[0]))]

node_program = rule(impl = _node_program, attrs = {"script": attrs.source(),
    "node": attrs.exec_dep(default = "root//:node", providers = [RunInfo]), "plugin": attrs.dep()})

def _settings():
    return {
        "node": attrs.exec_dep(default = "root//:node", providers = [RunInfo]),
        "rustc": attrs.string(default = read_config("extension", "rustc", "rustc")),
        "modules": attrs.string(default = read_config("extension", "modules", "node_modules")),
        "python": attrs.string(default = read_config("extension", "python", "python3")),
        "browser": attrs.string(default = read_config("extension", "browser", "")),
    }

def _arguments(ctx):
    return ["--node", ctx.attrs.node[RunInfo], "--rustc", ctx.attrs.rustc,
            "--modules", ctx.attrs.modules, "--browser", ctx.attrs.browser]

def _build(ctx):
    out = ctx.actions.declare_output("output", dir = True)
    tree = ctx.attrs.sources[DefaultInfo].default_outputs[0]
    args = cmd_args(ctx.attrs.python, tree.project("tools/build.py"), ctx.attrs.operation,
                    "--root", tree, "--out", out.as_output(), _arguments(ctx))
    if ctx.attrs.plugin:
        args.add("--plugin", ctx.attrs.plugin[DefaultInfo].default_outputs[0])
    ctx.actions.run(args, category = "extension_build", identifier = ctx.label.name, local_only = True)
    return [DefaultInfo(default_output = out)]

build_step = rule(impl = _build, attrs = dict(_settings(),
    operation = attrs.string(), sources = attrs.dep(), plugin = attrs.option(attrs.dep(), default = None)))

def _test(ctx):
    tree = ctx.attrs.sources[DefaultInfo].default_outputs[0]
    args = cmd_args(ctx.attrs.python, tree.project("tools/build.py"), ctx.attrs.operation,
                    "--root", tree, _arguments(ctx))
    if ctx.attrs.plugin:
        args.add("--plugin", ctx.attrs.plugin[DefaultInfo].default_outputs[0])
    if ctx.attrs.binary:
        args.add("--binary", ctx.attrs.binary[DefaultInfo].default_outputs[0])
    return [DefaultInfo(), ExternalRunnerTestInfo(type = "custom", command = [args],
        run_from_project_root = True, use_project_relative_paths = True, labels = [])]

extension_test = rule(impl = _test, attrs = dict(_settings(),
    operation = attrs.string(), sources = attrs.dep(), plugin = attrs.option(attrs.dep(), default = None),
    binary = attrs.option(attrs.dep(), default = None)))
