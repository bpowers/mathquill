/*************************************************
 * Base classes of edit tree-related objects
 *
 * Only doing tree node manipulation via these
 * adopt/ disown methods guarantees well-formedness
 * of the tree.
 ************************************************/

import { pray } from './intro';

// L = 'left'
// R = 'right'
//
// the contract is that they can be used as object properties
// and (-L) === R, and (-R) === L.
export enum Dir {
  L = -1,
  R = 1,
}
export const L = Dir.L;
export const R = Dir.R;

function prayDirection(dir: number): void {
  pray('a direction was passed', dir === Dir.L || dir === Dir.R);
}

class Point {
  readonly parent: Point;
  readonly left: Point;
  readonly right: Point;

  constructor(parent: Point, leftward: Point, rightward: Point) {
    this.parent = parent;
    this.left = leftward;
    this.right = rightward;
  }

  get(dir: Dir): Point {
    switch (dir) {
      case Dir.L:
        return this.left;
      case Dir.R:
        return this.right;
    }
  }

  static copy(pt: Point): Point {
    return new Point(pt.parent, pt.left, pt.right);
  }
}

class NodeEnds {
  left?: Node;
  right?: Node;

  set(dir: Dir, end: Node) {
    switch (dir) {
      case Dir.L:
        this.left = end;
        break;
      case Dir.R:
        this.right = end;
        break;
    }
  }

  get(dir: Dir): Node | undefined {
    switch (dir) {
      case Dir.L:
        return this.left;
      case Dir.R:
        return this.right;
    }
  }

  isEmpty(): boolean {
    return !this.left && !this.right;
  }
}

type NodeId = number;

/**
 * MathQuill virtual-DOM tree-node abstract base class
 */
class Node {
  readonly id: NodeId;
  parent?: Node;
  left?: Node;
  right?: Node;
  ends: NodeEnds;

  private static nextId: NodeId = 0;
  private static uniqueNodeId(): NodeId {
    const thisId = Node.nextId;
    Node.nextId += 1;
    return thisId;
  }

  private static byId = new Map<NodeId, Node>();

  constructor() {
    this.id = Node.uniqueNodeId();
    Node.byId.set(this.id, this);
    this.ends = new NodeEnds();
  };

  dispose(): void {
    Node.byId.delete(this.id);
  }

  toString(): string {
    return `{{ MathQuill Node #${this.id} }}`;
  };

  createDir(dir: Dir, cursor) {
    prayDirection(dir);
    var node = this;
    node.jQize();
    node.jQ.insDirOf(dir, cursor.jQ);
    cursor[dir] = node.adopt(cursor.parent, cursor[L], cursor[R]);
    return node;
  };
  _.createLeftOf = function (el) {
    return this.createDir(L, el);
  };

  _.selectChildren = function (leftEnd, rightEnd) {
    return Selection(leftEnd, rightEnd);
  };

  _.bubble = iterator(function (yield_) {
    for (var ancestor = this; ancestor; ancestor = ancestor.parent) {
      var result = yield_(ancestor);
      if (result === false) break;
    }

    return this;
  });

  _.postOrder = iterator(function (yield_) {
    (function recurse(descendant) {
      descendant.eachChild(recurse);
      yield_(descendant);
    })(this);

    return this;
  });

  isEmpty(): boolean {
    return this.ends.isEmpty();
  };

  isStyleBlock(): boolean {
    return false;
  };

  children(): Fragment {
    return new Fragment(this.ends.left, this.ends.right);
  };

  _.eachChild = function () {
    var children = this.children();
    children.each.apply(children, arguments);
    return this;
  };

  _.foldChildren = function (fold, fn) {
    return this.children().fold(fold, fn);
  };

  _.withDirAdopt = function (dir, parent, withDir, oppDir) {
    Fragment(this, this).withDirAdopt(dir, parent, withDir, oppDir);
    return this;
  };

  _.adopt = function (parent, leftward, rightward) {
    Fragment(this, this).adopt(parent, leftward, rightward);
    return this;
  };

  _.disown = function () {
    Fragment(this, this).disown();
    return this;
  };

  _.remove = function () {
    this.jQ.remove();
    this.postOrder('dispose');
    return this.disown();
  };
});

function prayWellFormed(parent, leftward, rightward) {
  pray('a parent is always present', parent);
  pray(
    'leftward is properly set up',
    (function () {
      // either it's empty and `rightward` is the left end child (possibly empty)
      if (!leftward) return parent.ends[L] === rightward;

      // or it's there and its [R] and .parent are properly set up
      return leftward[R] === rightward && leftward.parent === parent;
    })(),
  );

  pray(
    'rightward is properly set up',
    (function () {
      // either it's empty and `leftward` is the right end child (possibly empty)
      if (!rightward) return parent.ends[R] === leftward;

      // or it's there and its [L] and .parent are properly set up
      return rightward[L] === leftward && rightward.parent === parent;
    })(),
  );
}

/**
 * An entity outside the virtual tree with one-way pointers (so it's only a
 * "view" of part of the tree, not an actual node/entity in the tree) that
 * delimits a doubly-linked list of sibling nodes.
 * It's like a fanfic love-child between HTML DOM DocumentFragment and the Range
 * classes: like DocumentFragment, its contents must be sibling nodes
 * (unlike Range, whose contents are arbitrary contiguous pieces of subtrees),
 * but like Range, it has only one-way pointers to its contents, its contents
 * have no reference to it and in fact may still be in the visible tree (unlike
 * DocumentFragment, whose contents must be detached from the visible tree
 * and have their 'parent' pointers set to the DocumentFragment).
 */
class Fragment {
  readonly ends: NodeEnds;

  constructor(withDir: Node, oppDir: Node, dir?: Dir) {
    if (dir === undefined) {
      dir = L;
    }
    prayDirection(dir);

    pray('no half-empty fragments', !withDir === !oppDir);

    this.ends = new NodeEnds();

    if (!withDir) return;

    pray('withDir is passed to Fragment', withDir instanceof Node);
    pray('oppDir is passed to Fragment', oppDir instanceof Node);
    pray('withDir and oppDir have the same parent', withDir.parent === oppDir.parent);

    this.ends.set(dir, withDir);
    this.ends.set(-dir, oppDir);

    // To build the jquery collection for a fragment, accumulate elements
    // into an array and then call jQ.add once on the result. jQ.add sorts the
    // collection according to document order each time it is called, so
    // building a collection by folding jQ.add directly takes more than
    // quadratic time in the number of elements.
    //
    // https://github.com/jquery/jquery/blob/2.1.4/src/traversing.js#L112
    var accum = this.fold([], function (accum, el) {
      accum.push.apply(accum, el.jQ.get());
      return accum;
    });

    this.jQ = this.jQ.add(accum);
  };
  _.jQ = $();

  // like Cursor::withDirInsertAt(dir, parent, withDir, oppDir)
  _.withDirAdopt = function (dir, parent, withDir, oppDir) {
    return dir === L ? this.adopt(parent, withDir, oppDir) : this.adopt(parent, oppDir, withDir);
  };
  _.adopt = function (parent, leftward, rightward) {
    prayWellFormed(parent, leftward, rightward);

    var self = this;
    self.disowned = false;

    var leftEnd = self.ends[L];
    if (!leftEnd) return this;

    var rightEnd = self.ends[R];

    if (leftward) {
      // NB: this is handled in the ::each() block
      // leftward[R] = leftEnd
    } else {
      parent.ends[L] = leftEnd;
    }

    if (rightward) {
      rightward[L] = rightEnd;
    } else {
      parent.ends[R] = rightEnd;
    }

    self.ends[R][R] = rightward;

    self.each(function (el) {
      el[L] = leftward;
      el.parent = parent;
      if (leftward) leftward[R] = el;

      leftward = el;
    });

    return self;
  };

  _.disown = function () {
    var self = this;
    var leftEnd = self.ends[L];

    // guard for empty and already-disowned fragments
    if (!leftEnd || self.disowned) return self;

    self.disowned = true;

    var rightEnd = self.ends[R];
    var parent = leftEnd.parent;

    prayWellFormed(parent, leftEnd[L], leftEnd);
    prayWellFormed(parent, rightEnd, rightEnd[R]);

    if (leftEnd[L]) {
      leftEnd[L][R] = rightEnd[R];
    } else {
      parent.ends[L] = rightEnd[R];
    }

    if (rightEnd[R]) {
      rightEnd[R][L] = leftEnd[L];
    } else {
      parent.ends[R] = leftEnd[L];
    }

    return self;
  };

  _.remove = function () {
    this.jQ.remove();
    this.each('postOrder', 'dispose');
    return this.disown();
  };

  _.each = iterator(function (yield_) {
    var self = this;
    var el = self.ends[L];
    if (!el) return self;

    for (; el !== self.ends[R][R]; el = el[R]) {
      var result = yield_(el);
      if (result === false) break;
    }

    return self;
  });

  _.fold = function (fold, fn) {
    this.each(function (el) {
      fold = fn.call(this, fold, el);
    });

    return fold;
  };
});

/**
 * Registry of LaTeX commands and commands created when typing
 * a single character.
 *
 * (Commands are all subclasses of Node.)
 */
var LatexCmds = {},
  CharCmds = {};
