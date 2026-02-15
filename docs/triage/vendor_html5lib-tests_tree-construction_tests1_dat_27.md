# Tree divergence

Case: vendor/html5lib-tests/tree-construction/tests1.dat#27

## Input
```html
<script><div></script></div><title><p></title><p><p>
```

## Expected
```text
| <html>
|   <head>
|     <script>
|       "<div>"
|     <title>
|       "<p>"
|   <body>
|     <p>
|     <p>

```

## Actual
```text
| <script>
|   <div>
| <title>
|   <p>
| <p>
|   <p>
```
