import {parse} from 'acorn'

const dangerousGlobals = new Map([
    ['eval', 'eval'],
    ['Function', 'function-constructor'],
    ['setTimeout', 'timer:setTimeout'],
    ['setInterval', 'timer:setInterval'],
    ['WebAssembly', 'webassembly'],
    ['Reflect', 'reflect'],
])
const globalObjectNames = new Set(['globalThis', 'self', 'window'])
const timerTags = new Map([
    ['timer:setTimeout', 'setTimeout'],
    ['timer:setInterval', 'setInterval'],
])
const knownFunctionProperties = new Set([
    'at', 'bind', 'call', 'apply', 'concat', 'every', 'filter', 'find', 'findIndex',
    'flat', 'flatMap', 'forEach', 'map', 'pop', 'push', 'reduce', 'reduceRight',
    'reverse', 'shift', 'slice', 'some', 'sort', 'splice', 'unshift',
])

class Scope {
    constructor(parent, isFunction = false) {
        this.parent = parent
        this.isFunction = isFunction
        this.bindings = new Map()
    }
}

function unwrapExpression(node) {
    let current = node
    while (current?.type === 'ChainExpression') current = current.expression
    if (current?.type === 'SequenceExpression') return unwrapExpression(current.expressions.at(-1))
    return current
}

function walkChildren(node, visit) {
    for (const [key, value] of Object.entries(node)) {
        if (key === 'loc' || key === 'start' || key === 'end') continue
        if (Array.isArray(value)) {
            for (const child of value) {
                if (child && typeof child.type === 'string') visit(child, key)
            }
        } else if (value && typeof value.type === 'string') {
            visit(value, key)
        }
    }
}

function nearestFunctionScope(scope) {
    let current = scope
    while (current.parent && !current.isFunction) current = current.parent
    return current
}

function bindingFor(scope, name) {
    let current = scope
    while (current) {
        if (current.bindings.has(name)) return current.bindings.get(name)
        current = current.parent
    }
    return undefined
}

function declareIdentifier(identifier, scope, bindingIdentifiers) {
    bindingIdentifiers.add(identifier)
    let binding = scope.bindings.get(identifier.name)
    if (!binding) {
        binding = {name: identifier.name, sources: []}
        scope.bindings.set(identifier.name, binding)
    }
    return binding
}

function constantSyntaxString(node) {
    const current = unwrapExpression(node)
    if (current?.type === 'Literal' && (typeof current.value === 'string' || typeof current.value === 'number')) {
        return String(current.value)
    }
    if (current?.type === 'TemplateLiteral' && current.expressions.length === 0) {
        return current.quasis[0]?.value?.cooked
    }
    if (current?.type === 'BinaryExpression' && current.operator === '+') {
        const left = constantSyntaxString(current.left)
        const right = constantSyntaxString(current.right)
        return left === undefined || right === undefined ? undefined : left + right
    }
    return undefined
}

function staticPatternKey(property) {
    if (!property.computed && property.key?.type === 'Identifier') return property.key.name
    return constantSyntaxString(property.key)
}

function declarePattern(pattern, scope, bindingIdentifiers, pendingSources, source, sourceScope, projection = []) {
    if (!pattern) return
    if (pattern.type === 'Identifier') {
        const binding = declareIdentifier(pattern, scope, bindingIdentifiers)
        if (source) pendingSources.push({binding, node: source, scope: sourceScope, projection})
        return
    }
    if (pattern.type === 'AssignmentPattern') {
        declarePattern(pattern.left, scope, bindingIdentifiers, pendingSources, source || pattern.right, sourceScope, projection)
        return
    }
    if (pattern.type === 'RestElement') {
        declarePattern(pattern.argument, scope, bindingIdentifiers, pendingSources, undefined, sourceScope)
        return
    }
    if (pattern.type === 'ArrayPattern') {
        pattern.elements.forEach((element, index) => {
            declarePattern(element, scope, bindingIdentifiers, pendingSources, source, sourceScope, [...projection, String(index)])
        })
        return
    }
    if (pattern.type === 'ObjectPattern') {
        for (const property of pattern.properties) {
            if (property.type === 'RestElement') {
                declarePattern(property.argument, scope, bindingIdentifiers, pendingSources, undefined, sourceScope)
                continue
            }
            const key = staticPatternKey(property)
            declarePattern(property.value, scope, bindingIdentifiers, pendingSources,
                key === undefined ? undefined : source, sourceScope, key === undefined ? [] : [...projection, key])
        }
    }
}

function buildScopes(program) {
    const rootScope = new Scope(undefined, true)
    const scopeByNode = new WeakMap()
    const bindingIdentifiers = new WeakSet()
    const pendingSources = []
    const assignmentPatterns = []

    function visit(node, incomingScope) {
        let scope = incomingScope

        if (node.type === 'FunctionDeclaration' && node.id) {
            const outerBinding = declareIdentifier(node.id, incomingScope, bindingIdentifiers)
            pendingSources.push({binding: outerBinding, node, scope: incomingScope, projection: []})
        } else if (node.type === 'ClassDeclaration' && node.id) {
            const outerBinding = declareIdentifier(node.id, incomingScope, bindingIdentifiers)
            pendingSources.push({binding: outerBinding, node, scope: incomingScope, projection: []})
        }

        if (node.type === 'Program') {
            scope = rootScope
        } else if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression'
            || node.type === 'ArrowFunctionExpression') {
            scope = new Scope(incomingScope, true)
            if (node.id) {
                const localBinding = declareIdentifier(node.id, scope, bindingIdentifiers)
                pendingSources.push({binding: localBinding, node, scope, projection: []})
            }
            for (const parameter of node.params) {
                declarePattern(parameter, scope, bindingIdentifiers, pendingSources, undefined, scope)
            }
        } else if (node.type === 'BlockStatement' || node.type === 'CatchClause'
            || node.type === 'ForStatement' || node.type === 'ForInStatement'
            || node.type === 'ForOfStatement' || node.type === 'SwitchStatement') {
            scope = new Scope(incomingScope, false)
            if (node.type === 'CatchClause') {
                declarePattern(node.param, scope, bindingIdentifiers, pendingSources, undefined, scope)
            }
        } else if (node.type === 'ClassExpression') {
            scope = new Scope(incomingScope, false)
            if (node.id) {
                const localBinding = declareIdentifier(node.id, scope, bindingIdentifiers)
                pendingSources.push({binding: localBinding, node, scope, projection: []})
            }
        }

        scopeByNode.set(node, scope)

        if (node.type === 'VariableDeclaration') {
            const targetScope = node.kind === 'var' ? nearestFunctionScope(scope) : scope
            for (const declaration of node.declarations) {
                declarePattern(declaration.id, targetScope, bindingIdentifiers, pendingSources,
                    declaration.init, scope)
            }
        } else if (node.type === 'ImportDeclaration') {
            for (const specifier of node.specifiers) {
                declareIdentifier(specifier.local, scope, bindingIdentifiers)
            }
        } else if (node.type === 'AssignmentExpression') {
            assignmentPatterns.push({pattern: node.left, source: node.right, scope})
        }

        walkChildren(node, child => visit(child, scope))
    }

    visit(program, rootScope)

    for (const {binding, node, scope, projection} of pendingSources) {
        binding.sources.push({node, scope, projection})
    }
    for (const {pattern, source, scope} of assignmentPatterns) {
        addAssignmentSources(pattern, source, scope, [], bindingIdentifiers)
    }

    function addAssignmentSources(pattern, source, scope, projection, assignedIdentifiers) {
        if (!pattern) return
        if (pattern.type === 'Identifier') {
            assignedIdentifiers.add(pattern)
            const binding = bindingFor(scope, pattern.name)
            if (binding) binding.sources.push({node: source, scope, projection})
            return
        }
        if (pattern.type === 'AssignmentPattern') {
            addAssignmentSources(pattern.left, source || pattern.right, scope, projection, assignedIdentifiers)
            return
        }
        if (pattern.type === 'RestElement') {
            addAssignmentSources(pattern.argument, undefined, scope, [], assignedIdentifiers)
            return
        }
        if (pattern.type === 'ArrayPattern') {
            pattern.elements.forEach((element, index) => {
                addAssignmentSources(element, source, scope, [...projection, String(index)], assignedIdentifiers)
            })
            return
        }
        if (pattern.type === 'ObjectPattern') {
            for (const property of pattern.properties) {
                if (property.type === 'RestElement') {
                    addAssignmentSources(property.argument, undefined, scope, [], assignedIdentifiers)
                    continue
                }
                const propertyName = staticPatternKey(property)
                addAssignmentSources(property.value, propertyName === undefined ? undefined : source, scope,
                    propertyName === undefined ? [] : [...projection, propertyName], assignedIdentifiers)
            }
        }
    }

    return {scopeByNode, bindingIdentifiers}
}

function createResolver(scopeByNode) {
    function stringLike(node, fallbackScope, resolving = new Set()) {
        const current = unwrapExpression(node)
        if (!current) return false
        const scope = scopeByNode.get(current) || fallbackScope
        if (current.type === 'Literal') return typeof current.value === 'string'
        if (current.type === 'TemplateLiteral') return true
        if (current.type === 'BinaryExpression' && current.operator === '+') {
            return stringLike(current.left, scope, resolving) || stringLike(current.right, scope, resolving)
        }
        if (current.type === 'ConditionalExpression' || current.type === 'LogicalExpression') {
            return stringLike(current.consequent || current.left, scope, resolving)
                || stringLike(current.alternate || current.right, scope, resolving)
        }
        if (current.type === 'Identifier') {
            const binding = bindingFor(scope, current.name)
            if (!binding || resolving.has(binding)) return false
            const nextResolving = new Set(resolving).add(binding)
            return binding.sources.some(source => projectedStringLike(
                source.node, source.projection, source.scope, nextResolving,
            ))
        }
        return false
    }

    function projectedStringLike(node, projection, scope, resolving) {
        if (!node) return false
        if (projection.length === 0) return stringLike(node, scope, resolving)
        const current = unwrapExpression(node)
        const [propertyName, ...rest] = projection
        if (current?.type === 'Identifier') {
            const binding = bindingFor(scopeByNode.get(current) || scope, current.name)
            if (binding && !resolving.has(binding)) {
                const nextResolving = new Set(resolving).add(binding)
                return binding.sources.some(source => projectedStringLike(
                    source.node, [...source.projection, ...projection], source.scope, nextResolving,
                ))
            }
        }
        if (current?.type === 'ObjectExpression') {
            const property = current.properties.find(candidate => candidate.type === 'Property'
                && staticPatternKey(candidate) === propertyName)
            return property ? projectedStringLike(property.value, rest, scopeByNode.get(property.value) || scope, resolving) : false
        }
        if (current?.type === 'ArrayExpression' && /^\d+$/.test(propertyName)) {
            return projectedStringLike(current.elements[Number(propertyName)], rest, scope, resolving)
        }
        return false
    }

    function staticStrings(node, fallbackScope, resolving = new Set()) {
        const current = unwrapExpression(node)
        if (!current) return new Set()
        const scope = scopeByNode.get(current) || fallbackScope
        if (current.type === 'Literal' && typeof current.value === 'string') return new Set([current.value])
        if (current.type === 'TemplateLiteral') {
            let values = new Set([''])
            for (let index = 0; index < current.quasis.length; index += 1) {
                const quasi = current.quasis[index]?.value?.cooked ?? ''
                values = new Set([...values].map(value => value + quasi))
                if (index < current.expressions.length) {
                    const expressionValues = staticStrings(current.expressions[index], scope, resolving)
                    if (expressionValues.size === 0) return new Set()
                    values = new Set([...values].flatMap(prefix => [...expressionValues].map(value => prefix + value)))
                }
            }
            return values
        }
        if (current.type === 'BinaryExpression' && current.operator === '+') {
            const leftValues = staticStrings(current.left, scope, resolving)
            const rightValues = staticStrings(current.right, scope, resolving)
            if (leftValues.size === 0 || rightValues.size === 0) return new Set()
            return new Set([...leftValues].flatMap(left => [...rightValues].map(right => left + right)))
        }
        if (current.type === 'ConditionalExpression') {
            return new Set([
                ...staticStrings(current.consequent, scope, resolving),
                ...staticStrings(current.alternate, scope, resolving),
            ])
        }
        if (current.type === 'Identifier') {
            const binding = bindingFor(scope, current.name)
            if (!binding || resolving.has(binding)) return new Set()
            const nextResolving = new Set(resolving).add(binding)
            return new Set(binding.sources.flatMap(source => [
                ...projectedStrings(source.node, source.projection, source.scope, nextResolving),
            ]))
        }
        return new Set()
    }

    function projectedStrings(node, projection, scope, resolving) {
        if (!node) return new Set()
        if (projection.length === 0) return staticStrings(node, scope, resolving)
        const current = unwrapExpression(node)
        const [propertyName, ...rest] = projection
        if (current?.type === 'Identifier') {
            const binding = bindingFor(scopeByNode.get(current) || scope, current.name)
            if (binding && !resolving.has(binding)) {
                const nextResolving = new Set(resolving).add(binding)
                return new Set(binding.sources.flatMap(source => [
                    ...projectedStrings(source.node, [...source.projection, ...projection], source.scope, nextResolving),
                ]))
            }
        }
        if (current?.type === 'ObjectExpression') {
            const property = current.properties.find(candidate => candidate.type === 'Property'
                && staticPatternKey(candidate) === propertyName)
            return property ? projectedStrings(property.value, rest, scopeByNode.get(property.value) || scope, resolving) : new Set()
        }
        if (current?.type === 'ArrayExpression' && /^\d+$/.test(propertyName)) {
            return projectedStrings(current.elements[Number(propertyName)], rest, scope, resolving)
        }
        return new Set()
    }

    function applyMember(tags, propertyName) {
        const result = new Set()
        for (const tag of tags) {
            if (tag === 'global-object' && dangerousGlobals.has(propertyName)) {
                result.add(dangerousGlobals.get(propertyName))
            }
            if (tag === 'webassembly' && (propertyName === 'Module' || propertyName === 'Instance')) {
                result.add(`webassembly:${propertyName}`)
            }
            if (tag === 'reflect' && (propertyName === 'apply' || propertyName === 'construct')) {
                result.add(`reflect:${propertyName}`)
            }
            if (propertyName === 'call' || propertyName === 'apply' || propertyName === 'bind') {
                if (isCallableDanger(tag)) result.add(`invoke:${propertyName}:${tag}`)
            }
            if (propertyName === 'constructor') {
                result.add(tag === 'function-object' || tag === 'function-constructor'
                    ? 'function-constructor'
                    : 'function-object')
            }
        }
        return result
    }

    function projectedTags(node, projection, scope, resolving) {
        if (!node) return new Set()
        if (projection.length === 0) return tags(node, scope, resolving)
        const current = unwrapExpression(node)
        const [propertyName, ...rest] = projection
        if (current?.type === 'Identifier') {
            const binding = bindingFor(scopeByNode.get(current) || scope, current.name)
            if (binding && !resolving.has(binding)) {
                const nextResolving = new Set(resolving).add(binding)
                return new Set(binding.sources.flatMap(source => [
                    ...projectedTags(source.node, [...source.projection, ...projection], source.scope, nextResolving),
                ]))
            }
        }
        if (current?.type === 'ObjectExpression') {
            const property = current.properties.find(candidate => candidate.type === 'Property'
                && staticPatternKey(candidate) === propertyName)
            if (property) return projectedTags(property.value, rest, scopeByNode.get(property.value) || scope, resolving)
        }
        if (current?.type === 'ArrayExpression' && /^\d+$/.test(propertyName)) {
            return projectedTags(current.elements[Number(propertyName)], rest, scope, resolving)
        }
        let result = tags(current, scope, resolving)
        for (const member of projection) result = applyMember(result, member)
        return result
    }

    function tags(node, fallbackScope, resolving = new Set()) {
        const current = unwrapExpression(node)
        if (!current) return new Set()
        const scope = scopeByNode.get(current) || fallbackScope

        if (current.type === 'Identifier') {
            const binding = bindingFor(scope, current.name)
            if (binding) {
                if (resolving.has(binding)) return new Set()
                const nextResolving = new Set(resolving).add(binding)
                return new Set(binding.sources.flatMap(source => [
                    ...projectedTags(source.node, source.projection, source.scope, nextResolving),
                ]))
            }
            if (globalObjectNames.has(current.name)) return new Set(['global-object'])
            return dangerousGlobals.has(current.name) ? new Set([dangerousGlobals.get(current.name)]) : new Set()
        }
        if (current.type === 'FunctionExpression' || current.type === 'ArrowFunctionExpression'
            || current.type === 'FunctionDeclaration' || current.type === 'ClassExpression'
            || current.type === 'ClassDeclaration') {
            return new Set(['function-object'])
        }
        if (current.type === 'MemberExpression') {
            const propertyNames = staticStrings(current.property, scope)
            if (!current.computed && current.property.type === 'Identifier') propertyNames.add(current.property.name)
            const result = new Set()
            for (const propertyName of propertyNames) {
                const objectTags = tags(current.object, scope, resolving)
                for (const tag of applyMember(objectTags, propertyName)) result.add(tag)
                if (propertyName === 'constructor' && objectTags.size === 0) result.add('function-object')
                if (knownFunctionProperties.has(propertyName)) result.add('function-object')
                const object = unwrapExpression(current.object)
                if (object?.type === 'Identifier') {
                    const binding = bindingFor(scopeByNode.get(object) || scope, object.name)
                    if (binding && !resolving.has(binding)) {
                        const nextResolving = new Set(resolving).add(binding)
                        for (const source of binding.sources) {
                            for (const tag of projectedTags(source.node, [...source.projection, propertyName], source.scope, nextResolving)) {
                                result.add(tag)
                            }
                        }
                    }
                } else if (object?.type === 'ObjectExpression' || object?.type === 'ArrayExpression') {
                    for (const tag of projectedTags(object, [propertyName], scope, resolving)) result.add(tag)
                }
            }
            return result
        }
        if (current.type === 'CallExpression') {
            const result = new Set()
            for (const calleeTag of tags(current.callee, scope, resolving)) {
                if (calleeTag.startsWith('invoke:bind:')) result.add(`bound:${calleeTag.slice('invoke:bind:'.length)}`)
            }
            return result
        }
        if (current.type === 'ConditionalExpression') {
            return new Set([...tags(current.consequent, scope, resolving), ...tags(current.alternate, scope, resolving)])
        }
        if (current.type === 'LogicalExpression') {
            return new Set([...tags(current.left, scope, resolving), ...tags(current.right, scope, resolving)])
        }
        return new Set()
    }

    return {staticStrings, stringLike, tags}
}

function isCallableDanger(tag) {
    return tag === 'eval' || tag === 'function-constructor' || tag.startsWith('timer:')
        || tag.startsWith('bound:')
}

function directDanger(tag) {
    let current = tag
    while (current.startsWith('bound:')) current = current.slice('bound:'.length)
    return current
}

function invocation(tag) {
    if (!tag.startsWith('invoke:')) return undefined
    const [, kind, ...targetParts] = tag.split(':')
    return {kind, target: targetParts.join(':')}
}

function arrayArgument(node, index) {
    const current = unwrapExpression(node)
    return current?.type === 'ArrayExpression' ? current.elements[index] : undefined
}

function isReferenceIdentifier(node, parent, key, bindingIdentifiers) {
    if (bindingIdentifiers.has(node)) return false
    if (!parent) return true
    if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return false
    if ((parent.type === 'Property' || parent.type === 'MethodDefinition')
        && key === 'key' && !parent.computed && !parent.shorthand) return false
    if ((parent.type === 'LabeledStatement' || parent.type === 'BreakStatement'
        || parent.type === 'ContinueStatement') && key === 'label') return false
    return true
}

function finding(rule, node) {
    return {
        rule,
        line: node.loc?.start.line ?? 1,
        column: (node.loc?.start.column ?? 0) + 1,
    }
}

export function findForbiddenJavaScript(source, sourceName = '<extension-script>') {
    let program
    try {
        program = parse(source, {
            allowHashBang: true,
            ecmaVersion: 'latest',
            locations: true,
            sourceType: 'module',
        })
    } catch (error) {
        const suffix = error?.loc ? `:${error.loc.line}:${error.loc.column + 1}` : ''
        throw new Error(`Unable to parse ${sourceName}${suffix}; extension verification fails closed: ${error.message}`)
    }

    const {scopeByNode, bindingIdentifiers} = buildScopes(program)
    const resolver = createResolver(scopeByNode)
    const findings = []
    const reported = new Set()

    function report(rule, node) {
        const entry = finding(rule, node)
        const key = `${entry.rule}:${entry.line}:${entry.column}`
        if (!reported.has(key)) {
            reported.add(key)
            findings.push(entry)
        }
    }

    function inspectCall(node, scope) {
        const calleeTags = resolver.tags(node.callee, scope)
        for (const calleeTag of calleeTags) {
            const wrapped = invocation(calleeTag)
            const kind = wrapped?.kind || 'direct'
            const target = directDanger(wrapped?.target || calleeTag)
            const firstCodeArgument = kind === 'bind'
                ? node.arguments[1]
                : kind === 'call'
                ? node.arguments[1]
                : kind === 'apply'
                    ? arrayArgument(node.arguments[1], 0)
                    : node.arguments[0]

            if (target === 'eval') report('eval', node)
            if (target === 'function-constructor') report('Function constructor', node)
            if (timerTags.has(target) && resolver.stringLike(firstCodeArgument, scope)) {
                report(`string ${timerTags.get(target)}`, node)
            }
        }

        if (calleeTags.has('reflect:apply')) {
            for (const targetTag of resolver.tags(node.arguments[0], scope)) {
                const target = directDanger(targetTag)
                if (target === 'eval') report('indirect eval', node)
                if (target === 'function-constructor') report('Function constructor', node)
                if (timerTags.has(target)) {
                    const codeArgument = arrayArgument(node.arguments[2], 0)
                    if (resolver.stringLike(codeArgument, scope)) {
                        report(`string ${timerTags.get(target)}`, node)
                    }
                }
            }
        }
        if (calleeTags.has('reflect:construct')) {
            for (const targetTag of resolver.tags(node.arguments[0], scope)) {
                if (directDanger(targetTag) === 'function-constructor') report('Function constructor', node)
            }
        }
    }

    function visit(node, parent, key) {
        const scope = scopeByNode.get(node)
        if (node.type === 'Identifier' && isReferenceIdentifier(node, parent, key, bindingIdentifiers)) {
            if ([...resolver.tags(node, scope)].some(tag => tag === 'webassembly' || tag.startsWith('webassembly:'))) {
                report('WebAssembly runtime', node)
            }
        } else if (node.type === 'MemberExpression') {
            if ([...resolver.tags(node, scope)].some(tag => tag === 'webassembly' || tag.startsWith('webassembly:'))) {
                report('WebAssembly runtime', node)
            }
        }

        if ((node.type === 'CallExpression' || node.type === 'NewExpression')) inspectCall(node, scope)

        if (node.type !== 'Program' && [...resolver.staticStrings(node, scope)].some(value => /\.wasm\b/i.test(value))) {
            report('.wasm reference', node)
        }

        walkChildren(node, (child, childKey) => visit(child, node, childKey))
    }

    visit(program)
    return findings
}
