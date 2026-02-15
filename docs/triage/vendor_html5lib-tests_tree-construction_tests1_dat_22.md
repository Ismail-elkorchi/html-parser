# Tree divergence

Case: vendor/html5lib-tests/tree-construction/tests1.dat#22

## Input
```html
<h1>Hello<h2>World
```

## Expected
```text
| <html>
|   <head>
|   <body>
|     <h1>
|       "Hello"
|     <h2>
|       "World"

```

## Actual
```text
| <h1>
|   "Hello"
|   <h2>
|     "World"
```
