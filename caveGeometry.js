// game-server/caveGeometry.js

const CHAMBERS = [{"x":0,"z":0,"radius":100,"ceiling":34,"secretId":null},{"x":102.4,"z":27.3,"radius":15,"ceiling":14,"secretId":null},{"x":27.6,"z":102.3,"radius":15,"ceiling":14,"secretId":null},{"x":-74.8,"z":75.1,"radius":15,"ceiling":14,"secretId":null},{"x":-102.4,"z":-27.3,"radius":15,"ceiling":14,"secretId":null},{"x":-27.6,"z":-102.3,"radius":15,"ceiling":14,"secretId":null},{"x":74.8,"z":-75.1,"radius":15,"ceiling":14,"secretId":null},{"x":298.2,"z":32.9,"radius":13,"ceiling":9,"secretId":null},{"x":227.5,"z":128.3,"radius":12.4,"ceiling":9.5,"secretId":null},{"x":134.3,"z":177.3,"radius":18.3,"ceiling":13,"secretId":null},{"x":77.2,"z":166.6,"radius":12.2,"ceiling":9.5,"secretId":null},{"x":46.3,"z":137.2,"radius":18,"ceiling":13,"secretId":null},{"x":221.9,"z":201.9,"radius":13,"ceiling":9,"secretId":null},{"x":229.7,"z":124.4,"radius":11.4,"ceiling":9.5,"secretId":null},{"x":216.9,"z":49.2,"radius":19.8,"ceiling":13,"secretId":null},{"x":179.3,"z":39.5,"radius":13,"ceiling":9.5,"secretId":null},{"x":142.9,"z":23.4,"radius":18.8,"ceiling":13,"secretId":null},{"x":60.8,"z":293.8,"radius":13,"ceiling":9,"secretId":null},{"x":-51.7,"z":256,"radius":13.5,"ceiling":9.5,"secretId":null},{"x":-96.3,"z":200.5,"radius":21.1,"ceiling":13,"secretId":null},{"x":-124.3,"z":135.1,"radius":11.5,"ceiling":9.5,"secretId":null},{"x":-98.5,"z":106.1,"radius":17.2,"ceiling":13,"secretId":null},{"x":-123.5,"z":273.4,"radius":13,"ceiling":9,"secretId":null},{"x":-36.2,"z":258.7,"radius":13.2,"ceiling":9.5,"secretId":null},{"x":26,"z":220.9,"radius":20,"ceiling":13,"secretId":null},{"x":58,"z":174.2,"radius":12.4,"ceiling":9.5,"secretId":null},{"x":43.7,"z":138,"radius":20.9,"ceiling":13,"secretId":null},{"x":-260.6,"z":148.6,"radius":13,"ceiling":9,"secretId":null},{"x":-254.5,"z":59,"radius":11.1,"ceiling":9.5,"secretId":null},{"x":-222.1,"z":-10.6,"radius":19.5,"ceiling":13,"secretId":null},{"x":-180,"z":-36,"radius":11.2,"ceiling":9.5,"secretId":null},{"x":-140.1,"z":-36.5,"radius":19.1,"ceiling":13,"secretId":null},{"x":-298.2,"z":-32.9,"radius":13,"ceiling":9,"secretId":null},{"x":-253.3,"z":63.9,"radius":11.5,"ceiling":9.5,"secretId":null},{"x":-188.9,"z":117.5,"radius":18.8,"ceiling":13,"secretId":null},{"x":-136.9,"z":122.4,"radius":11.2,"ceiling":9.5,"secretId":null},{"x":-104.7,"z":100,"radius":21.6,"ceiling":13,"secretId":null},{"x":-221.9,"z":-201.9,"radius":13,"ceiling":9,"secretId":null},{"x":-74.4,"z":-250.4,"radius":11.2,"ceiling":9.5,"secretId":null},{"x":29.4,"z":-220.4,"radius":21.1,"ceiling":13,"secretId":null},{"x":75.9,"z":-167.2,"radius":13.3,"ceiling":9.5,"secretId":null},{"x":81.9,"z":-119.4,"radius":19.9,"ceiling":13,"secretId":null},{"x":-60.8,"z":-293.8,"radius":13,"ceiling":9,"secretId":null},{"x":-157.6,"z":-208.3,"radius":11.9,"ceiling":9.5,"secretId":null},{"x":-184.7,"z":-124,"radius":18.5,"ceiling":13,"secretId":null},{"x":-165.9,"z":-78.7,"radius":11.9,"ceiling":9.5,"secretId":null},{"x":-135.9,"z":-49.9,"radius":18.3,"ceiling":13,"secretId":null},{"x":123.5,"z":-273.4,"radius":13,"ceiling":9,"secretId":null},{"x":203.9,"z":-163.3,"radius":12.3,"ceiling":9.5,"secretId":null},{"x":209.9,"z":-73.5,"radius":17.2,"ceiling":13,"secretId":null},{"x":183.3,"z":-10.6,"radius":11.4,"ceiling":9.5,"secretId":null},{"x":142.2,"z":27.5,"radius":17.2,"ceiling":13,"secretId":null},{"x":260.6,"z":-148.6,"radius":13,"ceiling":9,"secretId":null},{"x":153.6,"z":-211.2,"radius":13.9,"ceiling":9.5,"secretId":null},{"x":50,"z":-216.7,"radius":20.1,"ceiling":13,"secretId":null},{"x":8.1,"z":-183.4,"radius":13.6,"ceiling":9.5,"secretId":null},{"x":-30.9,"z":-141.5,"radius":18.5,"ceiling":13,"secretId":null},{"x":116.5,"z":1.6,"radius":9.2,"ceiling":7.7,"secretId":"s01"},{"x":-19.6,"z":219.3,"radius":11.6,"ceiling":7.9,"secretId":"s02"},{"x":-2.4,"z":-256.8,"radius":10.8,"ceiling":7.8,"secretId":"s03"},{"x":-34.6,"z":-211.6,"radius":12,"ceiling":8.6,"secretId":"s04"},{"x":-254.5,"z":11.5,"radius":10.3,"ceiling":8,"secretId":"s05"},{"x":101.2,"z":-86.9,"radius":10.4,"ceiling":7.8,"secretId":"s06"},{"x":-27.5,"z":-182,"radius":10.7,"ceiling":8.1,"secretId":"s07"},{"x":41.8,"z":-175.1,"radius":10.6,"ceiling":7.9,"secretId":"s08"},{"x":207,"z":20.5,"radius":9.2,"ceiling":8.6,"secretId":"s09"},{"x":-86.9,"z":249.2,"radius":9.1,"ceiling":7.3,"secretId":"s10"},{"x":250.2,"z":55,"radius":9.9,"ceiling":8.1,"secretId":"s11"},{"x":202.3,"z":23.4,"radius":11.4,"ceiling":7.9,"secretId":"s12"},{"x":-62.7,"z":208.4,"radius":10.5,"ceiling":8.1,"secretId":"s13"},{"x":-170.2,"z":140.5,"radius":11,"ceiling":8.8,"secretId":"s14"},{"x":-134.1,"z":-82.7,"radius":9.7,"ceiling":7.2,"secretId":"s15"}];

const TUNNELS = [{"ax":102.4,"az":27.3,"bx":0,"bz":0,"halfWidth":6.5,"ceiling":13,"secretId":null},{"ax":27.6,"az":102.3,"bx":0,"bz":0,"halfWidth":6.5,"ceiling":13,"secretId":null},{"ax":-74.8,"az":75.1,"bx":0,"bz":0,"halfWidth":6.5,"ceiling":13,"secretId":null},{"ax":-102.4,"az":-27.3,"bx":0,"bz":0,"halfWidth":6.5,"ceiling":13,"secretId":null},{"ax":-27.6,"az":-102.3,"bx":0,"bz":0,"halfWidth":6.5,"ceiling":13,"secretId":null},{"ax":74.8,"az":-75.1,"bx":0,"bz":0,"halfWidth":6.5,"ceiling":13,"secretId":null},{"ax":298.2,"az":32.9,"bx":227.5,"bz":128.3,"halfWidth":5.4,"ceiling":8.5,"secretId":null},{"ax":227.5,"az":128.3,"bx":134.3,"bz":177.3,"halfWidth":4.7,"ceiling":8.5,"secretId":null},{"ax":134.3,"az":177.3,"bx":77.2,"bz":166.6,"halfWidth":4.6,"ceiling":8.5,"secretId":null},{"ax":77.2,"az":166.6,"bx":46.3,"bz":137.2,"halfWidth":5.3,"ceiling":8.5,"secretId":null},{"ax":46.3,"az":137.2,"bx":27.6,"bz":102.3,"halfWidth":5.2,"ceiling":9,"secretId":null},{"ax":221.9,"az":201.9,"bx":229.7,"bz":124.4,"halfWidth":4.4,"ceiling":8.5,"secretId":null},{"ax":229.7,"az":124.4,"bx":216.9,"bz":49.2,"halfWidth":4.4,"ceiling":8.5,"secretId":null},{"ax":216.9,"az":49.2,"bx":179.3,"bz":39.5,"halfWidth":5,"ceiling":8.5,"secretId":null},{"ax":179.3,"az":39.5,"bx":142.9,"bz":23.4,"halfWidth":4.5,"ceiling":8.5,"secretId":null},{"ax":142.9,"az":23.4,"bx":102.4,"bz":27.3,"halfWidth":5.2,"ceiling":9,"secretId":null},{"ax":60.8,"az":293.8,"bx":-51.7,"bz":256,"halfWidth":5.3,"ceiling":8.5,"secretId":null},{"ax":-51.7,"az":256,"bx":-96.3,"bz":200.5,"halfWidth":4.4,"ceiling":8.5,"secretId":null},{"ax":-96.3,"az":200.5,"bx":-124.3,"bz":135.1,"halfWidth":5,"ceiling":8.5,"secretId":null},{"ax":-124.3,"az":135.1,"bx":-98.5,"bz":106.1,"halfWidth":4.8,"ceiling":8.5,"secretId":null},{"ax":-98.5,"az":106.1,"bx":-74.8,"bz":75.1,"halfWidth":5.2,"ceiling":9,"secretId":null},{"ax":-123.5,"az":273.4,"bx":-36.2,"bz":258.7,"halfWidth":4.3,"ceiling":8.5,"secretId":null},{"ax":-36.2,"az":258.7,"bx":26,"bz":220.9,"halfWidth":4.7,"ceiling":8.5,"secretId":null},{"ax":26,"az":220.9,"bx":58,"bz":174.2,"halfWidth":4.6,"ceiling":8.5,"secretId":null},{"ax":58,"az":174.2,"bx":43.7,"bz":138,"halfWidth":4.3,"ceiling":8.5,"secretId":null},{"ax":43.7,"az":138,"bx":27.6,"bz":102.3,"halfWidth":5.2,"ceiling":9,"secretId":null},{"ax":-260.6,"az":148.6,"bx":-254.5,"bz":59,"halfWidth":4.4,"ceiling":8.5,"secretId":null},{"ax":-254.5,"az":59,"bx":-222.1,"bz":-10.6,"halfWidth":4.6,"ceiling":8.5,"secretId":null},{"ax":-222.1,"az":-10.6,"bx":-180,"bz":-36,"halfWidth":5.2,"ceiling":8.5,"secretId":null},{"ax":-180,"az":-36,"bx":-140.1,"bz":-36.5,"halfWidth":5.1,"ceiling":8.5,"secretId":null},{"ax":-140.1,"az":-36.5,"bx":-102.4,"bz":-27.3,"halfWidth":5.2,"ceiling":9,"secretId":null},{"ax":-298.2,"az":-32.9,"bx":-253.3,"bz":63.9,"halfWidth":4.9,"ceiling":8.5,"secretId":null},{"ax":-253.3,"az":63.9,"bx":-188.9,"bz":117.5,"halfWidth":4.5,"ceiling":8.5,"secretId":null},{"ax":-188.9,"az":117.5,"bx":-136.9,"bz":122.4,"halfWidth":4.8,"ceiling":8.5,"secretId":null},{"ax":-136.9,"az":122.4,"bx":-104.7,"bz":100,"halfWidth":5.1,"ceiling":8.5,"secretId":null},{"ax":-104.7,"az":100,"bx":-74.8,"bz":75.1,"halfWidth":5.2,"ceiling":9,"secretId":null},{"ax":-221.9,"az":-201.9,"bx":-74.4,"bz":-250.4,"halfWidth":5.1,"ceiling":8.5,"secretId":null},{"ax":-74.4,"az":-250.4,"bx":29.4,"bz":-220.4,"halfWidth":4.9,"ceiling":8.5,"secretId":null},{"ax":29.4,"az":-220.4,"bx":75.9,"bz":-167.2,"halfWidth":4.7,"ceiling":8.5,"secretId":null},{"ax":75.9,"az":-167.2,"bx":81.9,"bz":-119.4,"halfWidth":4.9,"ceiling":8.5,"secretId":null},{"ax":81.9,"az":-119.4,"bx":74.8,"bz":-75.1,"halfWidth":5.2,"ceiling":9,"secretId":null},{"ax":-60.8,"az":-293.8,"bx":-157.6,"bz":-208.3,"halfWidth":5.4,"ceiling":8.5,"secretId":null},{"ax":-157.6,"az":-208.3,"bx":-184.7,"bz":-124,"halfWidth":4.6,"ceiling":8.5,"secretId":null},{"ax":-184.7,"az":-124,"bx":-165.9,"bz":-78.7,"halfWidth":5,"ceiling":8.5,"secretId":null},{"ax":-165.9,"az":-78.7,"bx":-135.9,"bz":-49.9,"halfWidth":4.6,"ceiling":8.5,"secretId":null},{"ax":-135.9,"az":-49.9,"bx":-102.4,"bz":-27.3,"halfWidth":5.2,"ceiling":9,"secretId":null},{"ax":123.5,"az":-273.4,"bx":203.9,"bz":-163.3,"halfWidth":5.3,"ceiling":8.5,"secretId":null},{"ax":203.9,"az":-163.3,"bx":209.9,"bz":-73.5,"halfWidth":5.1,"ceiling":8.5,"secretId":null},{"ax":209.9,"az":-73.5,"bx":183.3,"bz":-10.6,"halfWidth":4.8,"ceiling":8.5,"secretId":null},{"ax":183.3,"az":-10.6,"bx":142.2,"bz":27.5,"halfWidth":4.6,"ceiling":8.5,"secretId":null},{"ax":142.2,"az":27.5,"bx":102.4,"bz":27.3,"halfWidth":5.2,"ceiling":9,"secretId":null},{"ax":260.6,"az":-148.6,"bx":153.6,"bz":-211.2,"halfWidth":5.1,"ceiling":8.5,"secretId":null},{"ax":153.6,"az":-211.2,"bx":50,"bz":-216.7,"halfWidth":5,"ceiling":8.5,"secretId":null},{"ax":50,"az":-216.7,"bx":8.1,"bz":-183.4,"halfWidth":5.1,"ceiling":8.5,"secretId":null},{"ax":8.1,"az":-183.4,"bx":-30.9,"bz":-141.5,"halfWidth":4.5,"ceiling":8.5,"secretId":null},{"ax":-30.9,"az":-141.5,"bx":-27.6,"bz":-102.3,"halfWidth":5.2,"ceiling":9,"secretId":null},{"ax":118.8,"az":25.7,"bx":116.5,"bz":1.6,"halfWidth":3.2,"ceiling":6.5,"secretId":"s01"},{"ax":-6.6,"az":240.7,"bx":-19.6,"bz":219.3,"halfWidth":3.2,"ceiling":6.5,"secretId":"s02"},{"ax":-9.6,"az":-231.7,"bx":-2.4,"bz":-256.8,"halfWidth":3.2,"ceiling":6.5,"secretId":"s03"},{"ax":-27.3,"az":-236.8,"bx":-34.6,"bz":-211.6,"halfWidth":3.2,"ceiling":6.5,"secretId":"s04"},{"ax":-273.5,"az":20.3,"bx":-254.5,"bz":11.5,"halfWidth":3.2,"ceiling":6.5,"secretId":"s05"},{"ax":77.3,"az":-90.7,"bx":101.2,"bz":-86.9,"halfWidth":3.2,"ceiling":6.5,"secretId":"s06"},{"ax":-9.1,"az":-164.9,"bx":-27.5,"bz":-182,"halfWidth":3.2,"ceiling":6.5,"secretId":"s07"},{"ax":57.2,"az":-188.6,"bx":41.8,"bz":-175.1,"halfWidth":3.2,"ceiling":6.5,"secretId":"s08"},{"ax":200.7,"az":45,"bx":207,"bz":20.5,"halfWidth":3.2,"ceiling":6.5,"secretId":"s09"},{"ax":-68.8,"az":234.7,"bx":-86.9,"bz":249.2,"halfWidth":3.2,"ceiling":6.5,"secretId":"s10"},{"ax":270.6,"az":70.1,"bx":250.2,"bz":55,"halfWidth":3.2,"ceiling":6.5,"secretId":"s11"},{"ax":196.9,"az":44.1,"bx":202.3,"bz":23.4,"halfWidth":3.2,"ceiling":6.5,"secretId":"s12"},{"ax":-79.3,"az":221.7,"bx":-62.7,"bz":208.4,"halfWidth":3.2,"ceiling":6.5,"secretId":"s13"},{"ax":-168.2,"az":119.5,"bx":-170.2,"bz":140.5,"halfWidth":3.2,"ceiling":6.5,"secretId":"s14"},{"ax":-151.4,"az":-64.7,"bx":-134.1,"bz":-82.7,"halfWidth":3.2,"ceiling":6.5,"secretId":"s15"}];

const SECRETS = [{"id":"s01","doorX":118.8,"doorZ":25.7,"doorAngle":4.616,"prompt":"g.cave.secret","requiresBoss":false},{"id":"s02","doorX":-6.6,"doorZ":240.7,"doorAngle":-2.117,"prompt":"g.cave.secret","requiresBoss":false},{"id":"s03","doorX":-9.6,"doorZ":-231.7,"doorAngle":-1.289,"prompt":"g.cave.secret","requiresBoss":false},{"id":"s04","doorX":-27.3,"doorZ":-236.8,"doorAngle":1.852,"prompt":"g.cave.secret","requiresBoss":false},{"id":"s05","doorX":-273.5,"doorZ":20.3,"doorAngle":-0.434,"prompt":"g.cave.secret","requiresBoss":false},{"id":"s06","doorX":77.3,"doorZ":-90.7,"doorAngle":0.159,"prompt":"g.cave.secret","requiresBoss":false},{"id":"s07","doorX":-9.1,"doorZ":-164.9,"doorAngle":3.891,"prompt":"g.cave.secret","requiresBoss":false},{"id":"s08","doorX":57.2,"doorZ":-188.6,"doorAngle":2.423,"prompt":"g.cave.secret","requiresBoss":false},{"id":"s09","doorX":200.7,"doorZ":45,"doorAngle":-1.318,"prompt":"g.cave.secret","requiresBoss":false},{"id":"s10","doorX":-68.8,"doorZ":234.7,"doorAngle":-3.819,"prompt":"g.cave.secret","requiresBoss":false},{"id":"s11","doorX":270.6,"doorZ":70.1,"doorAngle":3.779,"prompt":"g.cave.secret","requiresBoss":false},{"id":"s12","doorX":196.9,"doorZ":44.1,"doorAngle":-1.318,"prompt":"g.cave.secret","requiresBoss":false},{"id":"s13","doorX":-79.3,"doorZ":221.7,"doorAngle":-0.677,"prompt":"g.cave.secret","requiresBoss":false},{"id":"s14","doorX":-168.2,"doorZ":119.5,"doorAngle":1.665,"prompt":"g.cave.secret","requiresBoss":false},{"id":"s15","doorX":-151.4,"doorZ":-64.7,"doorAngle":-0.806,"prompt":"g.cave.secret","requiresBoss":false}];

const CHESTS = [{"id":"s01","x":116.5,"z":1.6},{"id":"s02","x":-19.6,"z":219.3},{"id":"s03","x":-2.4,"z":-256.8},{"id":"s04","x":-34.6,"z":-211.6},{"id":"s05","x":-254.5,"z":11.5},{"id":"s06","x":101.2,"z":-86.9},{"id":"s07","x":-27.5,"z":-182},{"id":"s08","x":41.8,"z":-175.1},{"id":"s09","x":207,"z":20.5},{"id":"s10","x":-86.9,"z":249.2},{"id":"s11","x":250.2,"z":55},{"id":"s12","x":202.3,"z":23.4},{"id":"s13","x":-62.7,"z":208.4},{"id":"s14","x":-170.2,"z":140.5},{"id":"s15","x":-134.1,"z":-82.7}];

const ENTRIES = [{"id":"e01","x":298.2,"z":32.9},{"id":"e02","x":221.9,"z":201.9},{"id":"e03","x":60.8,"z":293.8},{"id":"e04","x":-123.5,"z":273.4},{"id":"e05","x":-260.6,"z":148.6},{"id":"e06","x":-298.2,"z":-32.9},{"id":"e07","x":-221.9,"z":-201.9},{"id":"e08","x":-60.8,"z":-293.8},{"id":"e09","x":123.5,"z":-273.4},{"id":"e10","x":260.6,"z":-148.6}];

const PILLARS = [{"x":7,"z":14.4,"radius":4.6},{"x":-11.5,"z":11.1,"radius":4.6},{"x":-14.1,"z":-7.6,"radius":4.6},{"x":2.8,"z":-15.7,"radius":4.6},{"x":15.9,"z":-2.2,"radius":4.6},{"x":-24.6,"z":23.5,"radius":4.5},{"x":-33.7,"z":4.5,"radius":4.5},{"x":-29.9,"z":-16.2,"radius":4.5},{"x":-14.7,"z":-30.7,"radius":4.5},{"x":6.1,"z":-33.4,"radius":4.5},{"x":24.6,"z":-23.5,"radius":4.5},{"x":33.7,"z":-4.5,"radius":4.5},{"x":29.9,"z":16.2,"radius":4.5},{"x":14.7,"z":30.7,"radius":4.5},{"x":-6.1,"z":33.4,"radius":4.5},{"x":-45.7,"z":-24.9,"radius":4.2},{"x":-30.4,"z":-42.2,"radius":4.2},{"x":-9,"z":-51.2,"radius":4.2},{"x":14.1,"z":-50.1,"radius":4.2},{"x":34.4,"z":-39,"radius":4.2},{"x":47.9,"z":-20.2,"radius":4.2},{"x":51.9,"z":2.6,"radius":4.2},{"x":45.7,"z":24.9,"radius":4.2},{"x":30.4,"z":42.2,"radius":4.2},{"x":9,"z":51.2,"radius":4.2},{"x":-14.1,"z":50.1,"radius":4.2},{"x":-34.4,"z":39,"radius":4.2},{"x":-47.9,"z":20.2,"radius":4.2},{"x":-51.9,"z":-2.6,"radius":4.2},{"x":13.1,"z":-68.8,"radius":4},{"x":35.8,"z":-60.2,"radius":4},{"x":54.2,"z":-44.3,"radius":4},{"x":66.1,"z":-23.1,"radius":4},{"x":70,"z":0.9,"radius":4},{"x":65.5,"z":24.8,"radius":4},{"x":53,"z":45.7,"radius":4},{"x":34.2,"z":61.1,"radius":4},{"x":11.3,"z":69.1,"radius":4},{"x":-13.1,"z":68.8,"radius":4},{"x":-35.8,"z":60.2,"radius":4},{"x":-54.2,"z":44.3,"radius":4},{"x":-66.1,"z":23.1,"radius":4},{"x":-70,"z":-0.9,"radius":4},{"x":-65.5,"z":-24.8,"radius":4},{"x":-53,"z":-45.7,"radius":4},{"x":-34.2,"z":-61.1,"radius":4},{"x":-11.3,"z":-69.1,"radius":4},{"x":83,"z":-22.4,"radius":3.8},{"x":86,"z":1.9,"radius":3.8},{"x":82,"z":26.1,"radius":3.8},{"x":71.3,"z":48.1,"radius":3.8},{"x":54.8,"z":66.2,"radius":3.8},{"x":34,"z":79,"radius":3.8},{"x":10.3,"z":85.4,"radius":3.8},{"x":-14.1,"z":84.8,"radius":3.8},{"x":-37.5,"z":77.4,"radius":3.8},{"x":-57.8,"z":63.7,"radius":3.8},{"x":-73.4,"z":44.9,"radius":3.8},{"x":-83,"z":22.4,"radius":3.8},{"x":-86,"z":-1.9,"radius":3.8},{"x":-82,"z":-26.1,"radius":3.8},{"x":-71.3,"z":-48.1,"radius":3.8},{"x":-54.8,"z":-66.2,"radius":3.8},{"x":-34,"z":-79,"radius":3.8},{"x":-10.3,"z":-85.4,"radius":3.8},{"x":14.1,"z":-84.8,"radius":3.8},{"x":37.5,"z":-77.4,"radius":3.8},{"x":57.8,"z":-63.7,"radius":3.8},{"x":73.4,"z":-44.9,"radius":3.8}];

const ROCKS = [{"x":9.2,"z":-60.7,"radius":2.6},{"x":-69.3,"z":2.9,"radius":2.8},{"x":-70.6,"z":30.1,"radius":3.5},{"x":41.6,"z":9.5,"radius":3.1},{"x":-33.6,"z":58.1,"radius":2.5},{"x":-23.6,"z":50.8,"radius":2.6},{"x":-62,"z":45.7,"radius":3.6},{"x":28.6,"z":46.9,"radius":2.9},{"x":61.1,"z":-3.8,"radius":2.7},{"x":-7,"z":44.8,"radius":3.4},{"x":11.8,"z":-79.8,"radius":2.6},{"x":-7.8,"z":-68.5,"radius":2.5},{"x":67.4,"z":-0.1,"radius":2.8},{"x":-18.4,"z":-79.5,"radius":2.7},{"x":34.4,"z":11.7,"radius":2.4},{"x":68.2,"z":-9.6,"radius":2.8},{"x":-37.8,"z":-13.6,"radius":3},{"x":-23,"z":-38.7,"radius":2.4},{"x":19.1,"z":-67.4,"radius":3.6},{"x":-60.2,"z":-36.4,"radius":2.9},{"x":61,"z":-8.1,"radius":2.9},{"x":23.2,"z":-75,"radius":3.4},{"x":32.7,"z":-72.3,"radius":3.4},{"x":67.6,"z":-5.3,"radius":3.6},{"x":-5,"z":80.2,"radius":3.3},{"x":-30.9,"z":-61.6,"radius":3.2},{"x":30.2,"z":-10,"radius":3.5},{"x":-36.2,"z":46.4,"radius":2.6},{"x":28.1,"z":44.7,"radius":2.6},{"x":19,"z":72.3,"radius":3.6},{"x":-32.5,"z":-65.5,"radius":2.6},{"x":46.9,"z":-48.6,"radius":3},{"x":-55.2,"z":46.4,"radius":2.5},{"x":-15.3,"z":1.5,"radius":2.7}];

const ENEMY_SPAWNS = [{"type":"voidling","x":134.3,"z":177.3},{"type":"husk","x":77.2,"z":166.6},{"type":"voidling","x":52.3,"z":132.2},{"type":"voidling","x":216.9,"z":49.2},{"type":"husk","x":179.3,"z":39.5},{"type":"voidling","x":148.9,"z":18.4},{"type":"voidling","x":-96.3,"z":200.5},{"type":"husk","x":-124.3,"z":135.1},{"type":"voidling","x":-92.5,"z":101.1},{"type":"voidling","x":26,"z":220.9},{"type":"husk","x":58,"z":174.2},{"type":"voidling","x":49.7,"z":133},{"type":"voidling","x":-222.1,"z":-10.6},{"type":"husk","x":-180,"z":-36},{"type":"voidling","x":-134.1,"z":-41.5},{"type":"voidling","x":-188.9,"z":117.5},{"type":"husk","x":-136.9,"z":122.4},{"type":"voidling","x":-98.7,"z":95},{"type":"voidling","x":29.4,"z":-220.4},{"type":"husk","x":75.9,"z":-167.2},{"type":"voidling","x":87.9,"z":-124.4},{"type":"voidling","x":-184.7,"z":-124},{"type":"husk","x":-165.9,"z":-78.7},{"type":"voidling","x":-129.9,"z":-54.9},{"type":"voidling","x":209.9,"z":-73.5},{"type":"husk","x":183.3,"z":-10.6},{"type":"voidling","x":148.2,"z":22.5},{"type":"voidling","x":50,"z":-216.7},{"type":"husk","x":8.1,"z":-183.4},{"type":"voidling","x":-24.9,"z":-146.5},{"type":"husk","x":0,"z":55},{"type":"husk","x":50,"z":-30}];

const ENTRANCE = {"x":298.2,"z":32.9};
const BOSS_SPAWN = {"x":0,"z":0};
const BOSS_ARENA = {"x":0,"z":0,"radius":92};
const BOUNDS = {"minX":-330,"maxX":330,"minZ":-330,"maxZ":330};
const CHEST_REWARD = 1000;
const FLOOR_Y = 0;
const OUTER_RADIUS = 314;

function segmentDistance2D(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;

  let t = lengthSquared > 0 ? ((px - ax) * dx + (pz - az) * dz) / lengthSquared : 0;
  t = Math.max(0, Math.min(1, t));

  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

const OBSTACLE_ZONE = BOSS_ARENA.radius + 16;

function caveObstacleDistance(x, z) {
  if (Math.hypot(x - BOSS_ARENA.x, z - BOSS_ARENA.z) > OBSTACLE_ZONE) return Infinity;

  let nearest = Infinity;

  for (const pillar of PILLARS) {
    const d = Math.hypot(x - pillar.x, z - pillar.z) - pillar.radius;
    if (d < nearest) nearest = d;
  }

  for (const rock of ROCKS) {
    const d = Math.hypot(x - rock.x, z - rock.z) - rock.radius;
    if (d < nearest) nearest = d;
  }

  return nearest;
}

const GRID_CELL = 64;
const GRID_REACH = 64;
const FAR_DISTANCE = 999;

const ELEMENTS = [
  ...CHAMBERS.map((c, index) => ({
    kind: 0, index,
    minX: c.x - c.radius, maxX: c.x + c.radius,
    minZ: c.z - c.radius, maxZ: c.z + c.radius,
  })),
  ...TUNNELS.map((t, index) => ({
    kind: 1, index,
    minX: Math.min(t.ax, t.bx) - t.halfWidth, maxX: Math.max(t.ax, t.bx) + t.halfWidth,
    minZ: Math.min(t.az, t.bz) - t.halfWidth, maxZ: Math.max(t.az, t.bz) + t.halfWidth,
  })),
];

const GRID = new Map();
for (const element of ELEMENTS) {
  const x0 = Math.floor((element.minX - GRID_REACH) / GRID_CELL);
  const x1 = Math.floor((element.maxX + GRID_REACH) / GRID_CELL);
  const z0 = Math.floor((element.minZ - GRID_REACH) / GRID_CELL);
  const z1 = Math.floor((element.maxZ + GRID_REACH) / GRID_CELL);

  for (let ix = x0; ix <= x1; ix++) {
    for (let iz = z0; iz <= z1; iz++) {
      const key = ix + ',' + iz;
      const bucket = GRID.get(key);
      if (bucket) bucket.push(element);
      else GRID.set(key, [element]);
    }
  }
}

function caveDistance(x, z) {
  const bucket = GRID.get(Math.floor(x / GRID_CELL) + ',' + Math.floor(z / GRID_CELL));
  if (!bucket) return FAR_DISTANCE;

  let distance = Infinity;

  for (const element of bucket) {
    if (element.kind === 0) {
      const chamber = CHAMBERS[element.index];
      const d = Math.hypot(x - chamber.x, z - chamber.z) - chamber.radius;
      if (d < distance) distance = d;
    } else {
      const tunnel = TUNNELS[element.index];
      const d = segmentDistance2D(x, z, tunnel.ax, tunnel.az, tunnel.bx, tunnel.bz) - tunnel.halfWidth;
      if (d < distance) distance = d;
    }
  }

  const obstacle = caveObstacleDistance(x, z);
  if (obstacle < Infinity) distance = Math.max(distance, -obstacle);

  return distance === Infinity ? FAR_DISTANCE : distance;
}

function caveWalkable(x, z, clearance = 0) {
  return caveDistance(x, z) <= -clearance;
}

function segmentHitsCircle(ax, az, bx, bz, cx, cz, radius) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;

  let t = lengthSquared > 0 ? ((cx - ax) * dx + (cz - az) * dz) / lengthSquared : 0;
  t = Math.max(0, Math.min(1, t));

  const px = ax + dx * t;
  const pz = az + dz * t;
  return (px - cx) * (px - cx) + (pz - cz) * (pz - cz) <= radius * radius;
}

function caveCoverBetween(ax, az, bx, bz) {
  for (const pillar of PILLARS) {
    if (segmentHitsCircle(ax, az, bx, bz, pillar.x, pillar.z, pillar.radius)) return true;
  }

  for (const rock of ROCKS) {
    if (segmentHitsCircle(ax, az, bx, bz, rock.x, rock.z, rock.radius)) return true;
  }

  return false;
}

function caveSecretAt(x, z) {
  let distance = Infinity;
  let secretId = null;

  for (const chamber of CHAMBERS) {
    const d = Math.hypot(x - chamber.x, z - chamber.z) - chamber.radius;
    if (d < distance) {
      distance = d;
      secretId = chamber.secretId;
    }
  }

  for (const tunnel of TUNNELS) {
    const d = segmentDistance2D(x, z, tunnel.ax, tunnel.az, tunnel.bx, tunnel.bz) - tunnel.halfWidth;
    if (d < distance) {
      distance = d;
      secretId = tunnel.secretId;
    }
  }

  return secretId;
}

module.exports = {
  CHAMBERS,
  TUNNELS,
  SECRETS,
  CHESTS,
  ENTRIES,
  PILLARS,
  ROCKS,
  ENEMY_SPAWNS,
  ENTRANCE,
  BOSS_SPAWN,
  BOSS_ARENA,
  BOUNDS,
  CHEST_REWARD,
  FLOOR_Y,
  OUTER_RADIUS,
  segmentDistance2D,
  caveDistance,
  caveObstacleDistance,
  caveCoverBetween,
  segmentHitsCircle,
  caveWalkable,
  caveSecretAt,
};
