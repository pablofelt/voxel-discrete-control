module.exports = control

var Stream = require('stream').Stream

function control(opts) {
  return new DiscreteControl(opts)
}

function DiscreteControl(THREE, opts) {
  Stream.call(this)

  opts = opts || {}

  this.THREE=THREE
  this._action = 
  this._target = null

  this.readable =
  this.writable = true

  // the largest number of action that can be queued at a time 
  // (after exceeding this limit, additional actions are dropped)
  this.max_actions = opts.maxActions || 1024
  
  this._action_queue = []
  this.buffer = []
  this.paused = false
}

var cons = DiscreteControl
  , proto = cons.prototype = new Stream

proto.constructor = cons

proto.tick = function(dt) {
  if(!this._target) {
    return
  }

  // set up new action, if necessary
  this.setupAction()
  if (!this._action){
    return
  }

  // increment total elapsed time for this action
  this._action._elapsed += dt

  var target = this._target
    , action = this._action 
    , duration = action.duration 
    , height = action.height
    , radians = action.rotate
    , moverel_z = action._moverel_z
    , moverel_x = action._moverel_x
    , moveabs_z = action.translateZ
    , moveabs_x = action.translateX
    , elapsed = action._elapsed 
    , startpos = action._startpos
    , endpos = action._endpos
    , curvature

  // action complete
  if (elapsed >= duration){
    // end in precisely the correct state
    target.yaw.position.set(endpos['x'],endpos['y'],endpos['z'])
    target.rotation.y = action._endrotate
    this._action = null
    return
  }

  // relative z translation
  if (action.forward){
    target.avatar.translateZ(-(moverel_z/duration) * dt)
  }

  // relative x translation
  if (action.left){
    target.avatar.translateX(-(moverel_x/duration) * dt)
  }

  // absolute z translation
  if (action.translateZ){
    target.yaw.position.z += (moveabs_z/duration) * dt
  }

  // absolute x translation
  if (action.translateX){
    target.yaw.position.x += (moveabs_x/duration) * dt
  }

  // rotation
  if (action.rotate){
    target.rotation.y += (radians/duration) * dt
  }

  // calculate y position
  // 
  // TODO: modify to handle uneven landscapes
  // vertical movement is a parabolic arc wrt time
  // (this is simple enough that we don't need/want a 
  // full physics simulation)
  //
  //   Derivation:
  //     y = -curvature(x-dist/2)^2 + height (+ offset)
  //     We know y = x = 0, and dist, and height.
  //     Solving for curvature, we get curvature = height / (dist/2)^2
  curvature = height / Math.pow(duration/2,2)
  target.yaw.position.y = - curvature * Math.pow(elapsed - duration/2,2) + height + startpos['y'] 

}

// action start
proto.setupAction = function(){
  // nothing to do
  if (this._action || this._action_queue.length==0){
    return
  }

  // get action
  this._action = this._action_queue.shift()
  this.validateAction(this._action) // disallow conflicting actions
  var action = this._action
    , target = this._target
  
  // translate a moveto action into a combination of x,z translations
  if (action.moveto){
    var movetoz = action.moveto instanceof Array? action.moveto[2]: action.moveto['z']
    var movetox = action.moveto instanceof Array? action.moveto[0]: action.moveto['x']
    // z movement
    action.translateZ = movetoz - target.yaw.position['z'] 
    // x movement
    action.translateX = movetox - target.yaw.position['x'] 
  }

  // translate backward into -forward
  if (action.backward){
    action.forward = -action.backward
    action.backward = false
  }
  
  // translate right into -left
  if (action.right){
    action.left = -action.right
    action.right = false
  }

  // default values
  action.duration = action.duration || 1000
  action.height = action.height===undefined? .5: action.height 
  action.rotate = action.rotate || 0
  action._moverel_x = action.left || 0
  action._moverel_z = action.forward || 0
  action._moveabs_x = action.translateX || 0
  action._moveabs_z = action.translateZ || 0

  // precompute start and end states
  action._startpos = target.yaw.position.clone()
  action._endpos = this.getEndPosition(target.avatar, action)
  action._startrotate = target.rotation.y
  action._endrotate = action._startrotate + action.rotate 
  action._elapsed = 0 // accumulate time deltas here during the tick function
}

proto.validateAction = function(action){
  if (action.forward && action.backward){
    console.warn('action specified both forward and backward. Arbitrarily choosing forward.')
    action.backward = false
  }
  if (action.left && action.right){
    console.warn('action specified both left and right. Arbitrarily choosing left.')
    action.right = false
  }
  if (action.rotateleft && action.rotateright){
    console.warn('action specified both rotateleft and rotateright. Arbitrarily choosing rotateleft.')
    action.rotateright = false
  }
  if ((action.translateX || action.translateY || action.moveto) && (action.forward || action.backward || action.left || action.right)){
    console.warn('action specified both absolute (e.g., moveto) and relative (e.g., forward) movement. Arbitrarily preferring absolute movement.')
    action.forward = action.backward = action.left = action.right = false
  }
  if ((action.translateX || action.translateY) && action.moveto){
    console.warn('action specified both moveto and translateX,translateZ. Arbitrarily choosing moveto.')
    action.translateX = action.translateY = false
  }
}

proto.getEndPosition = function(avatar, action){
  var result
    , startpos = avatar.position.clone()
  if (action.forward){
    avatar.translateZ(-action.forward)
  }

  if (action.left){
    avatar.translateX(-action.left)
  }

  if (action.translateZ){
    avatar.position.z += action.translateZ
  }

  if (action.translateX){
    avatar.position.x += action.translateX
  }

  result = avatar.position.clone()
  avatar.position.copy(startpos)
  return result
}

proto.write = function(action) {
  if (this._action_queue.length > this.max_actions){
    console.warn("Actions in the queue exceed this.max_actions. Dropping the last one.")
    return false
  }
  this._action_queue.push(action)
}

proto.end = function(action) {
  if(action) {
    this.write(action)
  }
}

proto.createWriteRotationStream = function() {
  var action = this._action
    , stream = new Stream

  action.x_rotation_accum =
  action.y_rotation_accum =
  action.z_rotation_accum = 0

  stream.writable = true
  stream.write = write
  stream.end = end

  return stream

  function write(changes) {
    action.x_rotation_accum -= changes.dy || 0
    action.y_rotation_accum -= changes.dx || 0
    action.z_rotation_accum += changes.dz || 0
  }

  function end(deltas) {
    if(deltas) {
      stream.write(deltas)
    }
  }
}

proto.emitUpdate = function() {
  return this.outQueue({
      x_rotation_accum: this._action.x_rotation_accum
    , y_rotation_accum: this._action.y_rotation_accum
    , z_rotation_accum: this._action.z_rotation_accum
    , forward: this._action.forward
    , backward: this._action.backward
    , left: this._action.left
    , right: this._action.right
    , fire: this._action.fire
    , firealt: this._action.firealt
    , jump: this._action.jump
  })
}

proto.drain = function() {
  var buf = this.buffer
    , data

  while(buf.length && !this.paused) {
    data = buf.shift()
    if(null === data) {
      return this.emit('end')
    }
    this.emit('data', data)
  }
}

proto.resume = function() {
  this.paused = false
  this.drain()

  if(!this.paused) {
    this.emit('drain')
  }
  return this
}

proto.pause = function() {
  if(this.paused) return

  this.paused = true
  this.emit('pause')
  return this
}

proto.outQueue = function(data) {
  this.outQueue.push(data)
  this.drain()
  return this
}

proto.target = function(target) {
  if(target) {
    this._target = target
  }
  return this._target
}

proto.onfire = function(_) {

}

